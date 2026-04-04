const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const configPath = path.join(__dirname, '../config.json');
const DEFAULT_BACKEND_URL = 'http://localhost:8080';

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '/';
  }

  if (value === '*') {
    return '*';
  }

  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }

  return withLeadingSlash;
}

function normalizeRateLimit(rule) {
  if (!rule || typeof rule !== 'object') {
    return null;
  }

  const method = typeof rule.method === 'string' && rule.method.trim()
    ? rule.method.trim().toUpperCase()
    : '*';
  const pathPattern = normalizePath(rule.path || '*');
  const limit = Number(rule.limit);
  const windowMs = Number(rule.windowMs);

  if (!Number.isInteger(limit) || limit <= 0) {
    return null;
  }

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    return null;
  }

  return {
    method,
    path: pathPattern,
    limit,
    windowMs
  };
}

function dedupeStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
    )
  );
}

function normalizeConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const backendUrlValue = source.backendUrl || source.target || DEFAULT_BACKEND_URL;
  const backendUrl = new URL(backendUrlValue).toString().replace(/\/$/, '');
  const rateLimits = Array.isArray(source.rateLimits)
    ? source.rateLimits.map(normalizeRateLimit).filter(Boolean)
    : [];

  return {
    backendUrl,
    rateLimits,
    blacklistedIPs: dedupeStrings(source.blacklistedIPs)
  };
}

function createConfigManager({ onLog = () => {} } = {}) {
  let currentConfig = loadFromDisk();
  const listeners = new Set();
  let reloadTimer = null;

  function loadFromDisk() {
    const raw = fs.readFileSync(configPath, 'utf8');
    return normalizeConfig(JSON.parse(raw));
  }

  function notify() {
    for (const listener of listeners) {
      listener(currentConfig);
    }
  }

  function setConfig(nextConfig, reason) {
    currentConfig = nextConfig;

    if (reason) {
      onLog(reason);
    }

    notify();
  }

  function reload() {
    try {
      const nextConfig = loadFromDisk();
      setConfig(
        nextConfig,
        `Config reloaded (${nextConfig.rateLimits.length} rate limits, ${nextConfig.blacklistedIPs.length} blacklisted IPs)`
      );
    } catch (error) {
      onLog(`Config reload failed: ${error.message}`);
    }
  }

  function watch() {
    const watcher = fs.watch(configPath, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reload, 150);
    });

    watcher.on('error', (error) => {
      onLog(`Config watch error: ${error.message}`);
    });

    return watcher;
  }

  function persistBlacklistedIp(ip) {
    if (!ip || currentConfig.blacklistedIPs.includes(ip)) {
      return false;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const nextBlacklistedIPs = Array.from(
      new Set([...(Array.isArray(parsed.blacklistedIPs) ? parsed.blacklistedIPs : []), ip])
    );

    parsed.blacklistedIPs = nextBlacklistedIPs;

    fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

    const nextConfig = normalizeConfig(parsed);
    setConfig(nextConfig, `Persisted blacklisted IP ${ip} to config.json`);

    return true;
  }

  return {
    getConfig: () => currentConfig,
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    persistBlacklistedIp,
    watch
  };
}

module.exports = {
  createConfigManager,
  normalizePath
};
