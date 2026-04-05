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
setInterval(() => {
  metrics.requestsPerSecond = requestCountWindow;
  requestCountWindow = 0;
}, 1000);

function recordRequest() {
  metrics.totalRequests++;
  metrics.activeRequests++;
  requestCountWindow++;
}

function recordAllowed() {
  metrics.allowed++;
  metrics.activeRequests--;
}

function recordBlocked() {
  metrics.blocked++;
  metrics.activeRequests--;
}

function recordRateLimited() {
  metrics.rateLimited++;
  metrics.activeRequests--;
}

function recordBanned() {
  metrics.banned++;
  metrics.activeRequests--;
}

function getMetrics() {
  return { ...metrics };
}

module.exports = {
  recordRequest,
  recordAllowed,
  recordBlocked,
  recordRateLimited,
  recordBanned,
  getMetrics
};