const http = require('http');
const https = require('https');
const { URL } = require('url');

const scenario = (process.argv[2] || 'normal').toLowerCase();
const baseUrl = process.env.PROXYARMOR_BASE_URL || 'http://localhost:9090';
const proxyUrl = new URL(baseUrl);
const transport = proxyUrl.protocol === 'https:' ? https : http;

function sendRequest({ method = 'GET', path = '/', body = null, headers = {} }) {
  const targetUrl = new URL(path, proxyUrl);
  const payload = body == null
    ? ''
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);
  const requestHeaders = {
    ...headers
  };

  if (payload) {
    requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
    requestHeaders['content-length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: requestHeaders
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: responseBody
          });
        });
      }
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function formatBody(body) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function printResult(label, result) {
  console.log(`\n[${label}] ${result.statusCode}`);
  console.log(formatBody(result.body));
}

async function runNormalScenario() {
  console.log(`Running normal traffic demo against ${proxyUrl.origin}`);

  printResult(
    'GET /users',
    await sendRequest({
      path: '/users'
    })
  );

  printResult(
    'POST /login',
    await sendRequest({
      method: 'POST',
      path: '/login',
      body: {
        username: 'judge-demo',
        password: 'safe-password'
      }
    })
  );

  printResult(
    'GET /health',
    await sendRequest({
      path: '/health'
    })
  );
}

async function runSqlInjectionScenario() {
  console.log(`Running SQL injection demo against ${proxyUrl.origin}`);

  printResult(
    'GET /users?q=DROP TABLE',
    await sendRequest({
      path: '/users?q=DROP%20TABLE%20citizens'
    })
  );
}

async function runBlacklistScenario() {
  console.log(`Running blacklist escalation demo against ${proxyUrl.origin}`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    printResult(
      `Malicious attempt ${attempt}`,
      await sendRequest({
        path: `/users?q=DROP%20TABLE%20citizens_${attempt}`
      })
    );
  }

  printResult(
    'Benign request after blacklist',
    await sendRequest({
      path: '/users'
    })
  );
}

async function main() {
  switch (scenario) {
    case 'normal':
      await runNormalScenario();
      break;
    case 'sqli':
      await runSqlInjectionScenario();
      break;
    case 'blacklist':
      await runBlacklistScenario();
      break;
    default:
      console.error(`Unknown demo scenario "${scenario}". Use: normal, sqli, blacklist`);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
