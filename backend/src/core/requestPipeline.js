const { isBanned } = require('../middleware/reputation');
const metrics = require('../services/metrics');

function createRequestPipeline({
  waf,
  rateLimiter,
  increaseScore,
  forwardRequest,
  buildRequestSnapshot,
  logEvent,
  readRequestBody,
  sendJson,
  normalizeClientIp,
  normalizePath
}) {
  return async function handleRequest(req, res) {
    metrics.recordRequest();

    let requestUrl;

    try {
      requestUrl = new URL(req.url || '/', 'http://proxyarmor.local');
    } catch {
      metrics.recordBlocked();
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

    if (isBanned(clientIp)) {
      metrics.recordBanned();

      logEvent('Blocked', `BANNED IP ${clientIp} tried access`, {
        ...requestSnapshot,
        stage: 'reputation-ban'
      });

      sendJson(res, 403, {
        error: 'Forbidden',
        detail: 'Your IP is temporarily banned due to suspicious activity'
      });
      return;
    }

    let bodyBuffer;

    try {
      bodyBuffer = await readRequestBody(req);
    } catch (error) {
      metrics.recordBlocked();

      logEvent('Blocked', `${req.method} ${pathname} rejected: ${error.message}`, {
        ...requestSnapshot,
        reason: error.message,
        stage: 'pre-proxy'
      });

      sendJson(res, error.statusCode || 400, {
        error: 'Request Rejected',
        detail: error.message
      });
      return;
    }

    const bodyText = bodyBuffer.length ? bodyBuffer.toString('utf8') : '';

    const fullSnapshot = buildRequestSnapshot({
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
      metrics.recordBlocked();

      const score = increaseScore(clientIp, 2);

      logEvent('Blocked', `WAF blocked ${clientIp}`, {
        ...fullSnapshot,
        reason: wafResult.reason,
        stage: 'waf',
        reputation: score
      });

      sendJson(res, 403, {
        error: 'Forbidden',
        detail: wafResult.reason
      });
      return;
    }

    const rateLimitResult = rateLimiter.evaluate(clientIp, req.method, pathname);

    if (rateLimitResult.headers) {
      Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    if (!rateLimitResult.allowed) {
      metrics.recordRateLimited();

      const score = increaseScore(clientIp, 1);

      logEvent('RateLimited', `${clientIp} exceeded limit`, {
        ...fullSnapshot,
        stage: 'rate-limiter',
        reputation: score,
        retryAfterMs: rateLimitResult.retryAfterMs
      });

      sendJson(res, 429, {
        error: 'Too Many Requests',
        detail: 'Rate limit exceeded',
        retryAfterMs: rateLimitResult.retryAfterMs
      });
      return;
    }

    metrics.recordAllowed();

    forwardRequest({
      req,
      res,
      bodyBuffer,
      requestUrl,
      clientIp,
      requestSnapshot: fullSnapshot
    });
  };
}

module.exports = createRequestPipeline;