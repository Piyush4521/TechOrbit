const SQL_INJECTION_PATTERNS = [
  {
    expression: /\bselect\b/i,
    reason: 'SQL injection detected (SELECT keyword)',
    category: 'SQL Injection',
    signal: 'SELECT keyword'
  },
  {
    expression: /\bdrop\b/i,
    reason: 'SQL injection detected (DROP keyword)',
    category: 'SQL Injection',
    signal: 'DROP keyword'
  },
  {
    expression: /\bor\s+1=1\b/i,
    reason: 'SQL injection detected (OR 1=1 pattern)',
    category: 'SQL Injection',
    signal: 'OR 1=1 pattern'
  }
];

const XSS_PATTERNS = [
  {
    expression: /<script\b/i,
    reason: 'XSS detected (<script> tag)',
    category: 'Cross-Site Scripting',
    signal: '<script> tag'
  }
];

const MAX_VIOLATIONS = 3;
const WINDOW_MS = 5 * 60 * 1000;

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' '));
  } catch {
    return String(value);
  }
}

function createWaf({ onBlacklist = () => {} } = {}) {
  const violationsByIp = new Map();
  let blacklistedIPs = new Set();

  function updateConfig(config = {}) {
    blacklistedIPs = new Set(Array.isArray(config.blacklistedIPs) ? config.blacklistedIPs : []);
  }

  function recordViolation(ip, now = Date.now()) {
    const timestamps = violationsByIp.get(ip) || [];

    while (timestamps.length && now - timestamps[0] >= WINDOW_MS) {
      timestamps.shift();
    }

    timestamps.push(now);
    violationsByIp.set(ip, timestamps);

    if (timestamps.length >= MAX_VIOLATIONS) {
      if (!blacklistedIPs.has(ip)) {
        blacklistedIPs.add(ip);
        onBlacklist(ip);
      }

      return {
        blacklisted: true,
        violationCount: timestamps.length
      };
    }

    return {
      blacklisted: false,
      violationCount: timestamps.length
    };
  }

  function detectAttack(scanText) {
    const patterns = [...SQL_INJECTION_PATTERNS, ...XSS_PATTERNS];
    return patterns.find((pattern) => pattern.expression.test(scanText)) || null;
  }

  function inspect({ ip, pathname, search = '', headers = {}, bodyText = '' }) {
    if (blacklistedIPs.has(ip)) {
      return {
        allowed: false,
        reason: 'IP is permanently blacklisted',
        category: 'Blacklist',
        signal: 'Existing blacklist match',
        blacklisted: true,
        violationCount: MAX_VIOLATIONS,
        windowMs: WINDOW_MS,
        maxViolations: MAX_VIOLATIONS
      };
    }

    const headerSnapshot = [
      headers['user-agent'],
      headers['referer'],
      headers['x-forwarded-for']
    ]
      .filter(Boolean)
      .join('\n');

    const rawPayload = [pathname, search, bodyText, headerSnapshot].filter(Boolean).join('\n');
    const scanText = `${rawPayload}\n${safeDecode(rawPayload)}`;
    const detectedAttack = detectAttack(scanText);

    if (!detectedAttack) {
      return { allowed: true };
    }

    const violation = recordViolation(ip);

    return {
      allowed: false,
      reason: violation.blacklisted
        ? 'IP permanently blacklisted after 3 malicious requests in 5 minutes'
        : detectedAttack.reason,
      category: violation.blacklisted ? 'Blacklist' : detectedAttack.category,
      signal: violation.blacklisted ? 'Automatic blacklist escalation' : detectedAttack.signal,
      blacklisted: violation.blacklisted,
      violationCount: violation.violationCount,
      windowMs: WINDOW_MS,
      maxViolations: MAX_VIOLATIONS
    };
  }

  return {
    inspect,
    updateConfig
  };
}

module.exports = createWaf;
