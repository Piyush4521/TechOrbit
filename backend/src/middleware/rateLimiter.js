const { normalizePath } = require('../configManager');
const { getScore } = require('./reputation');

function getRulePriority(rule) {
  let score = 0;
  if (rule.method !== '*') score += 2;
  if (rule.path !== '*') score += 4;
  return score;
}

function pruneTimestamps(timestamps, windowMs, now) {
  while (timestamps.length && now - timestamps[0] >= windowMs) {
    timestamps.shift();
  }
}

function getEffectiveLimit(limit, score) {
  if (score >= 3) return Math.max(1, Math.floor(limit * 0.3));
  if (score >= 1) return Math.max(1, Math.floor(limit * 0.6));
  return limit;
}

function createRateLimiter() {
  const buckets = new Map();
  let rules = [];


  setInterval(() => {
    const now = Date.now();

    for (const [key, timestamps] of buckets.entries()) {
      if (!timestamps.length) {
        buckets.delete(key);
        continue;
      }

      pruneTimestamps(timestamps, 60000, now);

      if (timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, 30000); 

  function updateConfig(rateLimits = []) {
    rules = [...rateLimits].sort((a, b) => {
      return getRulePriority(b) - getRulePriority(a);
    });
  }

  function getMatchingRule(method, pathname) {
    return rules.find((rule) => {
      const methodMatch = rule.method === '*' || rule.method === method;
      const pathMatch = rule.path === '*' || rule.path === pathname;
      return methodMatch && pathMatch;
    });
  }

  function evaluate(ip, method, pathname, now = Date.now()) {
    const normalizedMethod = (method || 'GET').toUpperCase();
    const normalizedPath = normalizePath(pathname);

    const matchedRule = getMatchingRule(normalizedMethod, normalizedPath);

    if (!matchedRule) {
      return { allowed: true };
    }

    const bucketKey = `${ip}:${normalizedMethod}:${normalizedPath}`;
    const timestamps = buckets.get(bucketKey) || [];

    const reputationScore = getScore(ip);
    const effectiveLimit = getEffectiveLimit(matchedRule.limit, reputationScore);

    pruneTimestamps(timestamps, matchedRule.windowMs, now);

    const remaining = Math.max(0, effectiveLimit - timestamps.length);

    if (timestamps.length >= effectiveLimit) {
      const retryAfterMs = matchedRule.windowMs - (now - timestamps[0]);

      return {
        allowed: false,
        retryAfterMs,
        headers: {
          'X-RateLimit-Limit': effectiveLimit,
          'X-RateLimit-Remaining': 0,
          'Retry-After': Math.ceil(retryAfterMs / 1000)
        },
        effectiveLimit,
        configuredLimit: matchedRule.limit,
        windowMs: matchedRule.windowMs,
        score: reputationScore,
        rule: matchedRule
      };
    }

    timestamps.push(now);
    buckets.set(bucketKey, timestamps);

    return {
      allowed: true,
      headers: {
        'X-RateLimit-Limit': effectiveLimit,
        'X-RateLimit-Remaining': remaining - 1
      },
      effectiveLimit,
      configuredLimit: matchedRule.limit,
      windowMs: matchedRule.windowMs,
      score: reputationScore,
      rule: matchedRule
    };
  }

  return {
    evaluate,
    updateConfig
  };
}

module.exports = createRateLimiter;