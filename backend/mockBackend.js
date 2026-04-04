const http = require('http');
const { URL } = require('url');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(bodyText) {
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost:8080');
  const bodyText = await readBody(req);

  console.log(`Mock backend received ${req.method} ${requestUrl.pathname}`);

  if (req.method === 'GET' && (requestUrl.pathname === '/getAllUsers' || requestUrl.pathname === '/users')) {
    sendJson(res, 200, {
      users: ['Piyush', 'Dev', 'ProxyArmor Demo'],
      source: 'mock-backend'
    });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/login') {
    const payload = parseBody(bodyText) || {};

    sendJson(res, 200, {
      message: 'Login request reached the backend',
      receivedUser: payload.username || 'anonymous',
      token: 'demo-token'
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'mock-backend'
    });
    return;
  }

  sendJson(res, 200, {
    message: 'Mock backend handled the request',
    method: req.method,
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    body: parseBody(bodyText)
  });
});

server.listen(8080, () => {
  console.log('Mock backend running on http://localhost:8080');
});
