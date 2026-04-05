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
- Supports both judge-friendly snake_case config and internal camelCase config
- Includes repeatable demo scripts for normal traffic, SQL injection, blacklisting, and load tests
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
    scripts/
      demoTraffic.js
      runAutocannon.js
      updateConfig.js
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
  "target": "http://localhost:8080",
  "rate_limits": [
    {
      "method": "GET",
      "path": "/users",
      "limit": 100,
      "window": 60
    },
    {
      "method": "POST",
      "path": "/login",
      "limit": 5,
      "window": 60
    },
    {
      "method": "*",
      "path": "*",
      "limit": 60,
      "window": 60
    }
  ],
  "blocked_ips": []
}
```

The loader also accepts the original camelCase form:

- `backendUrl`
- `rateLimits`
- `windowMs`
- `blacklistedIPs`

## Run Locally

Open three terminals:

1. `cd backend && node mockBackend.js`
2. `cd backend && node src/proxy.js`
3. `cd frontend && npm run dev`

Then open `http://localhost:5173`.

## Demo Requests

- Allowed proxy request:
  `GET http://localhost:9090/users`

- Rate-limited endpoint:
  `POST http://localhost:9090/login`

- WAF block:
  `GET http://localhost:9090/users?q=DROP TABLE`

- SSE dashboard feed:
  `GET http://localhost:9090/events`

## Demo Scripts

From `backend/`:

- Normal traffic:
  `npm run demo:normal`

- One SQL injection request:
  `npm run demo:sqli`

- Three attacks plus auto-blacklist verification:
  `npm run demo:blacklist`

- Tighten `/login` to `2 req/min` without restarting:
  `npm run demo:config:login:2`

- Restore `/login` to `5 req/min` without restarting:
  `npm run demo:config:login:5`

- Brute-force style login load with `autocannon`:
  `npm run demo:perf:login`

- Sustained `/users` load test:
  `npm run demo:perf:users`

- Exact `5000 request` run for judge-style performance testing:
  `npm run demo:perf:5000`

The `autocannon` scripts use `npx`, so the first run may download the CLI automatically.

## Live Config Reload

Edit `backend/config.json` while the proxy is running. ProxyArmor watches the file, reloads the backend URL, rate-limit rules, and blacklist entries, and starts using the new values without a restart.

For the fastest demo:

1. Start `mockBackend.js`
2. Start `src/proxy.js`
3. Run `npm run demo:normal`
4. Run `npm run demo:perf:login`
5. Run `npm run demo:sqli`
6. Run `npm run demo:config:login:2`
7. Re-run `npm run demo:perf:login` without restarting anything
8. Run `npm run demo:perf:5000`

## Validation

Frontend:

- `npm run lint`
- `npm run build`

Backend:

- `node src/proxy.js`
- `node mockBackend.js`
- `npm run demo:normal`
- `npm run demo:sqli`
- `npm run demo:blacklist`
