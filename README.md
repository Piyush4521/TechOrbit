# ProxyArmor

ProxyArmor is a reverse-proxy demo that sits between a client and a backend service, applies lightweight security controls, and streams live activity to a dashboard.

## Project Layout

- `backend/` contains the proxy server, WAF, rate limiter, and mock backend.
- `frontend/` contains the Vite + React dashboard that listens to the proxy SSE feed.

## Run Locally

Open three terminals:

1. `cd backend && node mockBackend.js`
2. `cd backend && node src/proxy.js`
3. `cd frontend && npm run dev`

Then open `http://localhost:5173`.

## Demo Flow

- `http://localhost:9090/users` should proxy through to the mock backend.
- `http://localhost:9090/users?q=DROP TABLE` should be blocked by the WAF.
- Rapid repeated hits to `/users` should trigger rate limiting.
- Repeated attacks from the same client should trigger automatic blacklisting.

## Validation

Frontend:

- `npm run lint`
- `npm run build`
