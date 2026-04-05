const reputationMap = new Map();

const DECAY_INTERVAL = 60000; 
const DECAY_AMOUNT = 1;

const BAN_THRESHOLD = 10;
const BAN_DURATION = 5 * 60 * 1000; 

function getEntry(ip) {
  return reputationMap.get(ip) || { score: 0, bannedUntil: 0 };
}

function getScore(ip) {
  const entry = getEntry(ip);
  return entry.score;
}

function isBanned(ip) {
  const entry = getEntry(ip);
  return entry.bannedUntil > Date.now();
}

function increaseScore(ip, value = 1) {
  const delta = Number(value);

  if (!ip || !Number.isFinite(delta) || delta <= 0) {
    return getScore(ip);
  }

  const entry = getEntry(ip);
  entry.score += delta;

  if (entry.score >= BAN_THRESHOLD) {
    entry.bannedUntil = Date.now() + BAN_DURATION;
  }

  reputationMap.set(ip, entry);
  return entry.score;
}

function resetScore(ip) {
  reputationMap.delete(ip);
}

setInterval(() => {
  const now = Date.now();

  for (const [ip, entry] of reputationMap.entries()) {
    if (entry.bannedUntil && entry.bannedUntil < now) {
      entry.bannedUntil = 0;
    }

    if (entry.score > 0) {
      entry.score -= DECAY_AMOUNT;
    }
    if (entry.score <= 0 && entry.bannedUntil === 0) {
      reputationMap.delete(ip);
    } else {
      reputationMap.set(ip, entry);
    }
  }
}, DECAY_INTERVAL);

module.exports = {
  getScore,
  increaseScore,
  resetScore,
  isBanned
};