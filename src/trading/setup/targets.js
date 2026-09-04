'use strict';

const { MINIMUM_RISK_REWARD } = require('../contract');
const TIMEFRAMES = ['30m', '1h', '4h', '1d', '1w'];
const PREFERRED_RR = 2;

function finite(v) { return Number.isFinite(Number(v)); }
function rr(entry, stop, target, direction) {
  const risk = direction === 'LONG' ? entry - stop : stop - entry;
  const reward = direction === 'LONG' ? target - entry : entry - target;
  return risk > 0 && reward > 0 ? Number((reward / risk).toFixed(4)) : null;
}

function buildTargets({ entry, stop, direction, liquidity }) {
  if (!finite(entry) || !finite(stop)) return { valid: false, targets: [], riskReward: null, tp1RiskReward: null, reason: 'Entry and stop are required' };
  if (direction !== 'LONG' && direction !== 'SHORT') return { valid: false, targets: [], riskReward: null, tp1RiskReward: null, reason: 'Invalid trade direction' };

  const candidates = [];
  for (const timeframe of TIMEFRAMES) {
    const data = liquidity?.[timeframe];
    if (!data?.valid) continue;
    const levels = direction === 'LONG' ? data.buySide : data.sellSide;
    for (const level of Array.isArray(levels) ? levels : []) {
      const price = Number(level?.price);
      if (!finite(price) || level.swept === true) continue;
      if (direction === 'LONG' && price <= Number(entry)) continue;
      if (direction === 'SHORT' && price >= Number(entry)) continue;
      const riskReward = rr(Number(entry), Number(stop), price, direction);
      if (riskReward === null || riskReward < MINIMUM_RISK_REWARD) continue;
      candidates.push({
        price,
        timeframe,
        type: level.type || 'liquidity',
        side: level.side,
        liquidityClass: level.liquidityClass || null,
        riskReward,
      });
    }
  }

  const unique = [...new Map(candidates.map((c) => [String(c.price), c])).values()]
    .sort((a, b) => direction === 'LONG' ? a.price - b.price : b.price - a.price);

  if (!unique.length) {
    return {
      valid: false,
      targets: [],
      riskReward: null,
      tp1RiskReward: null,
      reason: `No genuine directional liquidity reaches the minimum ${MINIMUM_RISK_REWARD}R objective`,
    };
  }

  // TP1 is the nearest meaningful tradable objective, with a hard minimum of 1.5R.
  // Prefer a >=2R TP1 when genuine liquidity supports it, but never fabricate a level.
  const preferredIndex = unique.findIndex((candidate) => candidate.riskReward >= PREFERRED_RR);
  const start = preferredIndex >= 0 ? preferredIndex : 0;
  const selected = unique.slice(start, start + 3);

  const targets = selected.map((candidate, index) => ({
    index: index + 1,
    ...candidate,
  }));

  const tp1RiskReward = targets[0].riskReward;
  const overallRiskReward = targets[targets.length - 1].riskReward;

  return {
    valid: tp1RiskReward >= MINIMUM_RISK_REWARD,
    targets,
    // Overall RR is the RR of the furthest selected target, not TP1.
    riskReward: overallRiskReward,
    tp1RiskReward,
    preferredRiskReward: PREFERRED_RR,
    minimumRiskReward: MINIMUM_RISK_REWARD,
    reason: tp1RiskReward >= PREFERRED_RR
      ? `TP1 uses genuine directional liquidity at ${tp1RiskReward.toFixed(2)}R; overall RR is ${overallRiskReward.toFixed(2)}R`
      : `TP1 uses genuine directional liquidity at ${tp1RiskReward.toFixed(2)}R; 2R was not available without fabricating a target; overall RR is ${overallRiskReward.toFixed(2)}R`,
  };
}

module.exports = { buildTargets, PREFERRED_RR };
