const blacklist = new Set();
const violations = new Map();

const MAX_VIOLATIONS = 3;
const WINDOW_TIME = 5 * 60 * 1000;

function detectSQLInjection(url) {
  const patterns = [/select/i, /drop/i, /insert/i, /delete/i, /or 1=1/i];
  return patterns.some((pattern) => pattern.test(url));
}

function detectXSS(url) {
  const patterns = [/<script>/i, /<\/script>/i, /onerror/i, /onload/i];
  return patterns.some((pattern) => pattern.test(url));
}

function recordViolation(ip) {
  const now = Date.now();

  if (!violations.has(ip)) {
    violations.set(ip, { count: 1, firstTime: now });
    return false;
  }

  const record = violations.get(ip);

  if (now - record.firstTime > WINDOW_TIME) {
    violations.set(ip, { count: 1, firstTime: now });
    return false;
  }

  record.count += 1;

  if (record.count >= MAX_VIOLATIONS) {
    blacklist.add(ip);
    console.log(`🔥 AUTO-BLACKLISTED IP: ${ip}`);
    return true;
  }

  return false;
}

function waf(req) {
  const ip = req.socket.remoteAddress;
  const url = req.url;

  if (blacklist.has(ip)) {
    return {
      allowed: false,
      reason: 'IP is blacklisted'
    };
  }

  if (detectSQLInjection(url)) {
    const escalated = recordViolation(ip);

    return {
      allowed: false,
      reason: escalated
        ? 'IP auto-blacklisted due to repeated SQL attacks'
        : 'SQL Injection detected'
    };
  }

  if (detectXSS(url)) {
    const escalated = recordViolation(ip);

    return {
      allowed: false,
      reason: escalated
        ? 'IP auto-blacklisted due to repeated XSS attacks'
        : 'XSS attack detected'
    };
  }

  return { allowed: true };
}

module.exports = waf;
