const { normalizePath } = require('../configManager');
const { getScore } = require('./reputation');

function getRulePriority(rule) {
  let score = 0;

  if (rule.method !== '*') {
    score += 2;
  }

  if (rule.path !== '*') {
    score += 4;
  }

  return score;
}

function pruneTimestamps(timestamps, windowMs, now) {
  while (timestamps.length && now - timestamps[0] >= windowMs) {
    timestamps.shift();
  }
}

function getEffectiveLimit(limit, score) {
  if (score >= 3) {
    return Math.max(1, Math.floor(limit * 0.3));
  }

  if (score >= 1) {
    return Math.max(1, Math.floor(limit * 0.6));
  }

  return limit;
}

function createRateLimiter() {
  const buckets = new Map();
  let rules = [];

  function updateConfig(rateLimits = []) {
    rules = [...rateLimits].sort((left, right) => {
      return getRulePriority(right) - getRulePriority(left);
    });
  }

  function getMatchingRule(method, pathname) {
    return rules.find((rule) => {
      const matchesMethod = rule.method === '*' || rule.method === method;
      const matchesPath = rule.path === '*' || rule.path === pathname;
      return matchesMethod && matchesPath;
    });
  }

  function evaluate(ip, method, pathname, now = Date.now()) {
    const normalizedMethod = (method || 'GET').toUpperCase();
    const normalizedPath = normalizePath(pathname);
    const matchedRule = getMatchingRule(normalizedMethod, normalizedPath);

    if (!matchedRule) {
      return {
        allowed: true
      };
    }

    const bucketKey = `${ip}:${normalizedMethod}:${normalizedPath}`;
    const timestamps = buckets.get(bucketKey) || [];
    const reputationScore = getScore(ip);
    const effectiveLimit = getEffectiveLimit(matchedRule.limit, reputationScore);

    pruneTimestamps(timestamps, matchedRule.windowMs, now);

    if (timestamps.length >= effectiveLimit) {
      return {
        allowed: false,
        retryAfterMs: matchedRule.windowMs - (now - timestamps[0]),
        effectiveLimit,
        configuredLimit: matchedRule.limit,
        windowMs: matchedRule.windowMs,
        score: reputationScore,
        rule: {
          method: matchedRule.method,
          path: matchedRule.path
        }
      };
    }

    timestamps.push(now);
    buckets.set(bucketKey, timestamps);

    return {
      allowed: true,
      effectiveLimit,
      configuredLimit: matchedRule.limit,
      windowMs: matchedRule.windowMs,
      score: reputationScore,
      rule: {
        method: matchedRule.method,
        path: matchedRule.path
      }
    };
  }

  return {
    evaluate,
    updateConfig
  };
}

module.exports = createRateLimiter;
