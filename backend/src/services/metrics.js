const metrics = {
  totalRequests: 0,
  allowed: 0,
  blocked: 0,
  rateLimited: 0,
  banned: 0,
  activeRequests: 0,
  requestsPerSecond: 0
};

let requestCountWindow = 0;
let lastWindowTime = Date.now();

setInterval(() => {
  metrics.requestsPerSecond = requestCountWindow;
  requestCountWindow = 0;
  lastWindowTime = Date.now();
}, 1000);

function recordRequest() {
  metrics.totalRequests++;
  metrics.activeRequests++;
  requestCountWindow++;
}

function safeDecrementActive() {
  if (metrics.activeRequests > 0) {
    metrics.activeRequests--;
  }
}

function recordAllowed() {
  metrics.allowed++;
  safeDecrementActive();
}

function recordBlocked() {
  metrics.blocked++;
  safeDecrementActive();
}

function recordRateLimited() {
  metrics.rateLimited++;
  safeDecrementActive();
}

function recordBanned() {
  metrics.banned++;
  safeDecrementActive();
}

function normalizeMetrics() {
  const totalHandled =
    metrics.allowed +
    metrics.blocked +
    metrics.rateLimited +
    metrics.banned;

  if (totalHandled > metrics.totalRequests) {
    metrics.totalRequests = totalHandled;
  }
}

function getMetrics() {
  normalizeMetrics();

  return {
    ...metrics,
    successRate:
      metrics.totalRequests > 0
        ? ((metrics.allowed / metrics.totalRequests) * 100).toFixed(2)
        : "0.00",
    blockRate:
      metrics.totalRequests > 0
        ? (((metrics.blocked + metrics.rateLimited) / metrics.totalRequests) * 100).toFixed(2)
        : "0.00"
  };
}

module.exports = {
  recordRequest,
  recordAllowed,
  recordBlocked,
  recordRateLimited,
  recordBanned,
  getMetrics
};