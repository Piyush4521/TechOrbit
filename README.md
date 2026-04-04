# ProxyArmor

ProxyArmor is a hackathon-ready reverse proxy and API gateway built with the native Node.js `http` module only.

Architecture:

`Client -> ProxyArmor (port 9090) -> Backend Server (port 8080)`

## Highlights

- Reverse proxies HTTP traffic from `9090` to the backend in `config.json`
- Reads runtime settings from `backend/config.json`
- Reloads config automatically with `fs.watch()`
- Applies WAF checks before rate limiting
- Uses a sliding window log rate limiter per IP and per endpoint
- Permanently blacklists IPs after 3 malicious requests in 5 minutes
- Streams live events to the dashboard over Server-Sent Events at `/events`
- Uses only built-in Node.js modules for the gateway path

## Folder Structure

```text
proxyarmor-system/
  backend/
    config.json
    mockBackend.js
    src/
      configManager.js
      proxy.js
      server.js
      middleware/
        rateLimiter.js
        waf.js
  frontend/
    src/
      App.jsx
```

## Backend Modules

- `backend/src/proxy.js`
  The main gateway server. It accepts client traffic on port `9090`, runs WAF and rate limiting, proxies allowed requests to the configured backend, and broadcasts live logs over SSE.

- `backend/src/configManager.js`
  Loads `config.json`, normalizes the config shape, watches for file changes with `fs.watch()`, and persists newly blacklisted IPs back to disk.

- `backend/src/middleware/rateLimiter.js`
  Implements the sliding window log algorithm using `Map`. Requests are tracked by `IP + method + path`, so limits stay per IP and per endpoint.

- `backend/src/middleware/waf.js`
  Detects simple SQL injection and XSS payloads from the URL, decoded query string, headers, and request body. Repeated attacks escalate into permanent blacklisting.

- `backend/mockBackend.js`
  Demo backend on port `8080`. It exposes sample routes like `GET /getAllUsers`, `POST /login`, and `GET /health`.

## Config Example

`backend/config.json`

```json
{
  "backendUrl": "http://localhost:8080",
  "rateLimits": [
    {
      "method": "GET",
      "path": "/getAllUsers",
      "limit": 100,
      "windowMs": 60000
    },
    {
      "method": "POST",
      "path": "/login",
      "limit": 5,
      "windowMs": 60000
    },
    {
      "method": "*",
      "path": "*",
      "limit": 60,
      "windowMs": 60000
    }
  ],
  "blacklistedIPs": []
}
```

## Run Locally

Open three terminals:

1. `cd backend && node mockBackend.js`
2. `cd backend && node src/proxy.js`
3. `cd frontend && npm run dev`

Then open `http://localhost:5173`.

## Demo Requests

- Allowed proxy request:
  `GET http://localhost:9090/getAllUsers`

- Rate-limited endpoint:
  `POST http://localhost:9090/login`

- WAF block:
  `GET http://localhost:9090/users?q=DROP TABLE`

- SSE dashboard feed:
  `GET http://localhost:9090/events`

## Live Config Reload

Edit `backend/config.json` while the proxy is running. ProxyArmor watches the file, reloads the backend URL, rate-limit rules, and blacklist entries, and starts using the new values without a restart.

## Validation

Frontend:

- `npm run lint`
- `npm run build`

Backend:

- `node src/proxy.js`
- `node mockBackend.js`
- Hit the demo routes above and watch the dashboard feed update in real time
