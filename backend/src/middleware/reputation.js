const reputationMap = new Map();

function getScore(ip) {
  return reputationMap.get(ip) || 0;
}

function increaseScore(ip, value = 1) {
  const delta = Number(value);

  if (!ip || !Number.isFinite(delta) || delta <= 0) {
    return getScore(ip);
  }

  const nextScore = getScore(ip) + delta;
  reputationMap.set(ip, nextScore);
  return nextScore;
}

function resetScore(ip) {
  reputationMap.delete(ip);
}

module.exports = {
  getScore,
  increaseScore,
  resetScore
};
