const fs = require('fs');
const path = require('path');

const { normalizePath } = require('../src/configManager');

const method = (process.argv[2] || '*').trim().toUpperCase();
const rulePath = normalizePath(process.argv[3] || '*');
const limit = Number(process.argv[4]);
const windowSeconds = Number(process.argv[5] || 60);
const configPath = path.join(__dirname, '../config.json');

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function usesSnakeCaseConfig(source = {}) {
  return hasOwn(source, 'target') || hasOwn(source, 'rate_limits') || hasOwn(source, 'blocked_ips');
}

function readConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

if (!Number.isInteger(limit) || limit <= 0) {
  console.error('Usage: node scripts/updateConfig.js <METHOD> <PATH> <LIMIT> [WINDOW_SECONDS]');
  process.exit(1);
}

if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
  console.error('WINDOW_SECONDS must be a positive integer.');
  process.exit(1);
}

const rawConfig = readConfig();
const rateLimitKey = hasOwn(rawConfig, 'rate_limits') || usesSnakeCaseConfig(rawConfig)
  ? 'rate_limits'
  : 'rateLimits';
const rules = Array.isArray(rawConfig[rateLimitKey]) ? rawConfig[rateLimitKey] : [];
const useWindowSeconds = rateLimitKey === 'rate_limits'
  || rules.some((rule) => hasOwn(rule, 'window'));

let updated = false;

for (const rule of rules) {
  if (!rule || typeof rule !== 'object') {
    continue;
  }

  const ruleMethod = typeof rule.method === 'string' && rule.method.trim()
    ? rule.method.trim().toUpperCase()
    : '*';
  const normalizedRulePath = normalizePath(rule.path || '*');

  if (ruleMethod === method && normalizedRulePath === rulePath) {
    rule.method = method;
    rule.path = rulePath;
    rule.limit = limit;

    if (useWindowSeconds) {
      rule.window = windowSeconds;
      delete rule.windowMs;
    } else {
      rule.windowMs = windowSeconds * 1000;
      delete rule.window;
    }

    updated = true;
    break;
  }
}

if (!updated) {
  const nextRule = {
    method,
    path: rulePath,
    limit
  };

  if (useWindowSeconds) {
    nextRule.window = windowSeconds;
  } else {
    nextRule.windowMs = windowSeconds * 1000;
  }

  rules.push(nextRule);
}

rawConfig[rateLimitKey] = rules;
writeConfig(rawConfig);

console.log(`Updated ${method} ${rulePath} to limit=${limit} window=${windowSeconds}s in ${configPath}`);
