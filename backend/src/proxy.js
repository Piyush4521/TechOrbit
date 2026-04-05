const http = require('http');
const https = require('https');
const { URL } = require('url');

const { createConfigManager, normalizePath } = require('./configManager');
const createRateLimiter = require('./middleware/rateLimiter');
const { increaseScore } = require('./middleware/reputation');
const createWaf = require('./middleware/waf');

const PROXY_PORT = 9090;
const EVENTS_PATH = '/events';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CONCURRENT = 50;
const MAX_QUEUE_LENGTH = 200;
const BODY_PREVIEW_LIMIT = 600;
const SNAPSHOT_HEADER_KEYS = [
  'content-type',
  'content-length',
  'user-agent',
  'referer',
  'x-forwarded-for'
];

const sseClients = new Set();
const rateLimiter = createRateLimiter();
const requestQueue = [];
let processing = 0;
let nextEventId = 1;

function broadcast(payload) {
  const serialized = JSON.stringify(payload);

  for (const client of sseClients) {
    if (client.writableEnded || client.destroyed) {
      sseClients.delete(client);
      continue;
    }

    client.write(`data: ${serialized}\n\n`);
  }
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function serializeHeaders(headers = {}) {
  return SNAPSHOT_HEADER_KEYS.reduce((snapshot, key) => {
    const value = normalizeHeaderValue(headers[key]);

    if (value) {
      snapshot[key] = value;
    }

    return snapshot;
  }, {});
}

function serializeQueryParams(searchParams) {
  return Array.from(searchParams.entries()).map(([key, value]) => ({ key, value }));
}

function truncateText(value, limit = BODY_PREVIEW_LIMIT) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}...`;
}

function sanitizeDetails(details = {}) {
  return Object.entries(details).reduce((clean, [key, value]) => {
    if (value === undefined || value === null || value === '') {
      return clean;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        clean[key] = value;
      }

      return clean;
    }

    if (typeof value === 'object') {
      if (Object.keys(value).length > 0) {
        clean[key] = value;
      }

      return clean;
    }

    clean[key] = value;
    return clean;
  }, {});
}

function buildRequestSnapshot({ req, requestUrl, pathname, clientIp, bodyBuffer = null }) {
  const snapshot = {
    method: (req.method || 'GET').toUpperCase(),
    path: pathname,
    rawPath: `${pathname}${requestUrl.search}`,
    search: requestUrl.search,
    queryParams: serializeQueryParams(requestUrl.searchParams),
    ip: clientIp,
    headers: serializeHeaders(req.headers)
  };

  if (bodyBuffer) {
    const bodyText = bodyBuffer.length ? bodyBuffer.toString('utf8') : '';
    snapshot.bodyBytes = bodyBuffer.length;
    snapshot.bodyPreview = truncateText(bodyText);
  }

  return sanitizeDetails(snapshot);
}

function logEvent(type, message, details = {}) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${type}: ${message}`;
  const payload = {
    id: nextEventId++,
    timestamp,
    type,
    message,
    line,
    details: sanitizeDetails(details)
  };

  console.log(line);
  broadcast(payload);
  return payload;
}

const configManager = createConfigManager({
  onLog: (message) => logEvent('Config', message)
});

const waf = createWaf({
  onBlacklist: (ip) => {
    configManager.persistBlacklistedIp(ip);
    logEvent('Blacklisted', `${ip} permanently blacklisted`, {
      ip,
      category: 'Blacklist',
      stage: 'waf'
    });
  }
});

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(': connected\n\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
}

function normalizeClientIp(rawIp) {
  if (!rawIp) {
    return 'unknown';
  }

  if (rawIp === '::1') {
    return '127.0.0.1';
  }

  if (rawIp.startsWith('::ffff:')) {
    return rawIp.slice(7);
  }

  return rawIp;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }

      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        settled = true;

        const error = new Error('Request body exceeds 1 MB');
        error.statusCode = 413;

        reject(error);
        req.resume();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('aborted', () => {
      if (!settled) {
        settled = true;

        const error = new Error('Client aborted request');
        error.statusCode = 400;

        reject(error);
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    req.resume();
  });
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function applyConfig(config) {
  rateLimiter.updateConfig(config.rateLimits);
  waf.updateConfig(config);
}

function finishQueuedRequest(entry) {
  if (!entry || entry.completed) {
    return;
  }

  entry.completed = true;
}

function dequeueNextRequest() {
  while (processing < MAX_CONCURRENT && requestQueue.length > 0) {
    const next = requestQueue.shift();

    if (!next || next.completed || next.req.destroyed || next.res.destroyed || next.res.writableEnded) {
      continue;
    }

    next.completed = true;
    processRequest(next.req, next.res);
  }
}

function queueRequest(req, res) {
  const clientIp = normalizeClientIp(req.socket.remoteAddress);

  if (requestQueue.length >= MAX_QUEUE_LENGTH) {
    logEvent('Dropped', `${req.method} ${req.url || '/'} rejected because the queue is full`, {
      method: (req.method || 'GET').toUpperCase(),
      path: req.url || '/',
      ip: clientIp,
      queueLength: requestQueue.length,
      maxQueueLength: MAX_QUEUE_LENGTH,
      stage: 'queue',
      statusCode: 503
    });
    sendJson(res, 503, {
      error: 'Service Unavailable',
      detail: 'ProxyArmor is overloaded. Please retry shortly.'
    });
    return;
  }

  const entry = {
    req,
    res,
    completed: false
  };

  const cancelQueuedRequest = () => {
    finishQueuedRequest(entry);
  };

  req.pause();
  req.once('aborted', cancelQueuedRequest);
  req.once('close', cancelQueuedRequest);
  res.once('close', cancelQueuedRequest);

  requestQueue.push(entry);
  logEvent('Queued', `${req.method} ${req.url || '/'} queued (${requestQueue.length} waiting)`, {
    method: (req.method || 'GET').toUpperCase(),
    path: req.url || '/',
    ip: clientIp,
    queueLength: requestQueue.length,
    maxQueueLength: MAX_QUEUE_LENGTH,
    stage: 'queue'
  });
}

async function handleRequest(req, res) {
  let requestUrl;

  try {
    requestUrl = new URL(req.url || '/', 'http://proxyarmor.local');
  } catch {
    sendJson(res, 400, { error: 'Bad Request', detail: 'Invalid request URL' });
    return;
  }

  const clientIp = normalizeClientIp(req.socket.remoteAddress);
  const pathname = normalizePath(requestUrl.pathname);
  const requestSnapshot = buildRequestSnapshot({
    req,
    requestUrl,
    pathname,
    clientIp
  });

  logEvent('Incoming', `${req.method} ${pathname}${requestUrl.search} from ${clientIp}`, requestSnapshot);

  let bodyBuffer;

  try {
    bodyBuffer = await readRequestBody(req);
  } catch (error) {
    logEvent('Blocked', `${req.method} ${pathname} rejected before proxying: ${error.message}`, {
      ...requestSnapshot,
      reason: error.message,
      category: 'Request Validation',
      stage: 'pre-proxy',
      statusCode: error.statusCode || 400
    });
    sendJson(res, error.statusCode || 400, {
      error: 'Request Rejected',
      detail: error.message
    });
    return;
  }

  const bodyText = bodyBuffer.length ? bodyBuffer.toString('utf8') : '';
  const fullRequestSnapshot = buildRequestSnapshot({
    req,
    requestUrl,
    pathname,
    clientIp,
    bodyBuffer
  });

  const wafResult = waf.inspect({
    ip: clientIp,
    pathname,
    search: requestUrl.search,
    headers: req.headers,
    bodyText
  });

  if (!wafResult.allowed) {
    const nextScore = increaseScore(clientIp, 2);
    logEvent(
      'Blocked',
      `${wafResult.reason} from ${clientIp} on ${req.method} ${pathname} (reputation ${nextScore})`,
      {
        ...fullRequestSnapshot,
        reason: wafResult.reason,
        category: wafResult.category || 'Threat Detected',
        signal: wafResult.signal,
        reputation: nextScore,
        blacklisted: Boolean(wafResult.blacklisted),
        violationCount: wafResult.violationCount,
        maxViolations: wafResult.maxViolations,
        violationWindowMs: wafResult.windowMs,
        stage: 'waf',
        statusCode: 403
      }
    );
    sendJson(res, 403, {
      error: 'Forbidden',
      detail: wafResult.reason
    });
    return;
  }

  const rateLimitResult = rateLimiter.evaluate(clientIp, req.method, pathname);

  if (!rateLimitResult.allowed) {
    const nextScore = increaseScore(clientIp, 1);
    logEvent(
      'RateLimited',
      `${clientIp} exceeded ${req.method} ${pathname} at limit ${rateLimitResult.effectiveLimit} (reputation ${nextScore})`,
      {
        ...fullRequestSnapshot,
        category: 'Rate Limit',
        reputation: nextScore,
        effectiveLimit: rateLimitResult.effectiveLimit,
        configuredLimit: rateLimitResult.configuredLimit,
        retryAfterMs: rateLimitResult.retryAfterMs,
        windowMs: rateLimitResult.windowMs,
        matchedRule: rateLimitResult.rule,
        stage: 'rate-limiter',
        statusCode: 429
      }
    );
    sendJson(res, 429, {
      error: 'Too Many Requests',
      detail: 'Sliding window rate limit exceeded',
      retryAfterMs: rateLimitResult.retryAfterMs
    });
    return;
  }

  forwardRequest({
    req,
    res,
    bodyBuffer,
    requestUrl,
    clientIp,
    requestSnapshot: fullRequestSnapshot
  });
}

function processRequest(req, res) {
  processing += 1;

  let released = false;
  const release = () => {
    if (released) {
      return;
    }

    released = true;
    processing = Math.max(0, processing - 1);
    dequeueNextRequest();
  };

  res.once('finish', release);
  res.once('close', release);

  handleRequest(req, res).catch((error) => {
    logEvent('ProxyError', `${req.method} ${req.url || '/'} failed before proxying: ${error.message}`, {
      method: (req.method || 'GET').toUpperCase(),
      path: req.url || '/',
      reason: error.message,
      stage: 'pre-proxy',
      statusCode: 500
    });

    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'Internal Server Error',
        detail: 'ProxyArmor failed while processing the request'
      });
      return;
    }

    if (!res.writableEnded) {
      res.end();
    }
  });
}

function forwardRequest({ req, res, bodyBuffer, requestUrl, clientIp, requestSnapshot }) {
  const { backendUrl } = configManager.getConfig();
  const backend = new URL(backendUrl);
  const targetUrl = new URL(req.url || '/', backend);
  const transport = targetUrl.protocol === 'https:' ? https : http;

  const headers = {
    ...req.headers,
    host: targetUrl.host,
    'x-forwarded-for': req.headers['x-forwarded-for']
      ? `${req.headers['x-forwarded-for']}, ${clientIp}`
      : clientIp,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'http'
  };

  if (bodyBuffer.length > 0) {
    headers['content-length'] = bodyBuffer.length;
  } else {
    delete headers['content-length'];
  }

  const proxyRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers
    },
    (proxyResponse) => {
      setCorsHeaders(res);
      res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(res);

      logEvent(
        'Allowed',
        `${req.method} ${requestUrl.pathname} -> ${proxyResponse.statusCode || 502} for ${clientIp}`,
        {
          ...requestSnapshot,
          backendUrl,
          targetOrigin: targetUrl.origin,
          targetPath: `${targetUrl.pathname}${targetUrl.search}`,
          upstreamStatus: proxyResponse.statusCode || 502,
          stage: 'proxy',
          statusCode: proxyResponse.statusCode || 502
        }
      );
    }
  );

  proxyRequest.setTimeout(15000, () => {
    proxyRequest.destroy(new Error('Upstream timed out'));
  });

  proxyRequest.on('error', (error) => {
    logEvent('ProxyError', `${req.method} ${requestUrl.pathname} failed: ${error.message}`, {
      ...requestSnapshot,
      reason: error.message,
      backendUrl,
      targetOrigin: targetUrl.origin,
      targetPath: `${targetUrl.pathname}${targetUrl.search}`,
      stage: 'proxy',
      statusCode: 502
    });

    if (!res.headersSent) {
      sendJson(res, 502, {
        error: 'Bad Gateway',
        detail: 'ProxyArmor could not reach the backend service'
      });
    } else {
      res.end();
    }
  });

  if (bodyBuffer.length > 0) {
    proxyRequest.write(bodyBuffer);
  }

  proxyRequest.end();
}

applyConfig(configManager.getConfig());
configManager.onUpdate(applyConfig);

const configWatcher = configManager.watch();

const heartbeat = setInterval(() => {
  for (const client of sseClients) {
    if (client.writableEnded || client.destroyed) {
      sseClients.delete(client);
      continue;
    }

    client.write(': heartbeat\n\n');
  }
}, 20000);

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let requestUrl;

  try {
    requestUrl = new URL(req.url || '/', 'http://proxyarmor.local');
  } catch {
    sendJson(res, 400, { error: 'Bad Request', detail: 'Invalid request URL' });
    return;
  }

  if (requestUrl.pathname === EVENTS_PATH) {
    handleEvents(req, res);
    return;
  }

  if (processing >= MAX_CONCURRENT) {
    queueRequest(req, res);
    return;
  }

  processRequest(req, res);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

function shutdown() {
  clearInterval(heartbeat);
  configWatcher.close();

  for (const client of sseClients) {
    client.end();
  }

  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PROXY_PORT, () => {
  logEvent(
    'Startup',
    `ProxyArmor listening on http://localhost:${PROXY_PORT} and forwarding to ${configManager.getConfig().backendUrl}`
  );
});

module.exports = server;
