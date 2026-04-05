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

const sseClients = new Set();
const rateLimiter = createRateLimiter();
const requestQueue = [];
let processing = 0;

function broadcast(message) {
  for (const client of sseClients) {
    if (client.writableEnded || client.destroyed) {
      sseClients.delete(client);
      continue;
    }

    client.write(`data: ${message}\n\n`);
  }
}

function logEvent(type, message) {
  const line = `[${new Date().toISOString()}] ${type}: ${message}`;
  console.log(line);
  broadcast(line);
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
  if (requestQueue.length >= MAX_QUEUE_LENGTH) {
    logEvent('Dropped', `${req.method} ${req.url || '/'} rejected because the queue is full`);
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
  logEvent('Queued', `${req.method} ${req.url || '/'} queued (${requestQueue.length} waiting)`);
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

  logEvent('Incoming', `${req.method} ${pathname}${requestUrl.search} from ${clientIp}`);

  let bodyBuffer;

  try {
    bodyBuffer = await readRequestBody(req);
  } catch (error) {
    logEvent('Blocked', `${req.method} ${pathname} rejected before proxying: ${error.message}`);
    sendJson(res, error.statusCode || 400, {
      error: 'Request Rejected',
      detail: error.message
    });
    return;
  }

  const bodyText = bodyBuffer.length ? bodyBuffer.toString('utf8') : '';

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
      `${wafResult.reason} from ${clientIp} on ${req.method} ${pathname} (reputation ${nextScore})`
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
      `${clientIp} exceeded ${req.method} ${pathname} at limit ${rateLimitResult.effectiveLimit} (reputation ${nextScore})`
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
    clientIp
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
    logEvent('ProxyError', `${req.method} ${req.url || '/'} failed before proxying: ${error.message}`);

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

function forwardRequest({ req, res, bodyBuffer, requestUrl, clientIp }) {
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
        `${req.method} ${requestUrl.pathname} -> ${proxyResponse.statusCode || 502} for ${clientIp}`
      );
    }
  );

  proxyRequest.setTimeout(15000, () => {
    proxyRequest.destroy(new Error('Upstream timed out'));
  });

  proxyRequest.on('error', (error) => {
    logEvent('ProxyError', `${req.method} ${requestUrl.pathname} failed: ${error.message}`);

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
