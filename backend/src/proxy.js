const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const rateLimiter = require('./middleware/rateLimiter');
const waf = require('./middleware/waf');

const EVENTS_PATH = '/events';
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8')
);

let clients = [];

function broadcast(message) {
  clients = clients.filter((client) => !client.writableEnded && !client.destroyed);

  clients.forEach((client) => {
    client.write(`data: ${message}\n\n`);
  });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter((client) => client !== res);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === EVENTS_PATH) {
    handleEvents(req, res);
    return;
  }

  console.log(`📥 Incoming Request: ${req.url}`);
  broadcast(`📥 Incoming: ${req.url}`);

  const clientIP = req.socket.remoteAddress;
  const wafResult = waf(req);

  if (!wafResult.allowed) {
    console.log(`🚫 WAF BLOCKED: ${clientIP} -> ${wafResult.reason}`);
    broadcast(`🚫 WAF BLOCKED: ${clientIP}`);

    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(`Blocked: ${wafResult.reason}`);
    return;
  }

  if (!rateLimiter(clientIP)) {
    console.log(`⚠️ RATE LIMITED: ${clientIP}`);
    broadcast(`⚠️ RATE LIMITED: ${clientIP}`);

    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Too Many Requests - Rate Limit Exceeded');
    return;
  }

  const target = new URL(req.url, config.target);
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);
  broadcast(`✅ Allowed: ${req.url}`);

  proxyReq.on('error', (err) => {
    console.error('❌ Proxy Error:', err);
    broadcast('❌ Proxy Error');

    res.writeHead(500);
    res.end('Proxy Error');
  });
});

server.listen(9090, () => {
  console.log('🛡️ ProxyArmor running on http://localhost:9090');
});
