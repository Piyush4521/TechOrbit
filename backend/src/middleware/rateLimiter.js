const rateLimitMap = new Map();

const WINDOW_SIZE = 10 * 1000;
const MAX_REQUESTS = 5;

function rateLimiter(ip) {
  const currentTime = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip);

  while (timestamps.length && currentTime - timestamps[0] > WINDOW_SIZE) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_REQUESTS) {
    return false;
  }

  timestamps.push(currentTime);
  return true;
}

module.exports = rateLimiter;
