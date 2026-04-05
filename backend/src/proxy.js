const http = require('http');
const https = require('https');
const { URL } = require('url');

const createRequestPipeline = require('./core/requestPipeline');
const { createConfigManager, normalizePath } = require('./configManager');
const createRateLimiter = require('./middleware/rateLimiter');
const { increaseScore } = require('./middleware/reputation');
const createWaf = require('./middleware/waf');

const {
  getMetrics,
  recordRequest,
  recordAllowed,
  recordBlocked,
  recordRateLimited
} = require('./services/metrics');

const PROXY_PORT = 9090;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CONCURRENT = 50;
const MAX_QUEUE_LENGTH = 200;

const rateLimiter = createRateLimiter();
const requestQueue = [];
let processing = 0;

const sseClients = new Set();

function logEvent(type, message, details = {}) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${type}: ${message}`;
  console.log(line);

  const payload = `data: ${JSON.stringify({
    id: Date.now(),
    type,
    message,
    details
  })}\n\n`;

  sseClients.forEach(client => client.write(payload));

  return { timestamp, type, message, details };
}

const configManager = createConfigManager({
  onLog: (message) => logEvent('Config', message)
});

const waf = createWaf({
  onBlacklist: (ip) => {
    configManager.persistBlacklistedIp(ip);
    logEvent('Blacklisted', `${ip} permanently blacklisted`);
  }
});

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function normalizeClientIp(rawIp) {
  if (!rawIp) return 'unknown';
  if (rawIp === '::1') return '127.0.0.1';
  if (rawIp.startsWith('::ffff:')) return rawIp.slice(7);
  return rawIp;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        const err = new Error('Body too large');
        err.statusCode = 413;
        reject(err);
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function forwardRequest({ req, res, bodyBuffer }) {
  const { backendUrl } = configManager.getConfig();
  const backend = new URL(backendUrl);
  const targetUrl = new URL(req.url || '/', backend);

  const transport = targetUrl.protocol === 'https:' ? https : http;

  console.log("Forwarding to:", targetUrl.href);

  const proxyReq = transport.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: req.headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);

      logEvent('Allowed', `${req.method} ${req.url}`);

      recordAllowed();
    }
  );

  proxyReq.on('error', (err) => {
    console.error("Proxy Error:", err.message);

    recordBlocked();

    sendJson(res, 502, { error: 'Bad Gateway', detail: err.message });
  });

  if (bodyBuffer.length > 0) {
    proxyReq.write(bodyBuffer);
  }

  proxyReq.end();
}

const handleRequest = createRequestPipeline({
  waf,
  rateLimiter,
  increaseScore,
  forwardRequest,
  buildRequestSnapshot: () => ({}),
  logEvent,
  readRequestBody,
  sendJson,
  normalizeClientIp,
  normalizePath
});

function processRequest(req, res) {
  recordRequest();

  processing++;

  res.on('finish', () => {
    processing--;
    dequeueNextRequest();
  });

  handleRequest(req, res);
}

function dequeueNextRequest() {
  while (processing < MAX_CONCURRENT && requestQueue.length > 0) {
    const { req, res } = requestQueue.shift();
    processRequest(req, res);
  }
}

function queueRequest(req, res) {
  if (requestQueue.length >= MAX_QUEUE_LENGTH) {
    sendJson(res, 503, { error: 'Server Busy' });
    return;
  }

  requestQueue.push({ req, res });
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write('data: connected\n\n');

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });

    return;
  }

  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getMetrics(), null, 2));
    return;
  }

  if (processing >= MAX_CONCURRENT) {
    queueRequest(req, res);
    return;
  }

  processRequest(req, res);
});

server.listen(PROXY_PORT, () => {
  console.log(`🚀 ProxyArmor running on port ${PROXY_PORT}`);
});