'use strict';

const MAX_SCORE = 100;
const MIN_PUBLISH_SCORE = 70;
const MIN_PREFERRED_RR = 2;
const MIN_ACCEPTABLE_RR = 1.5;

function finite(v) { return Number.isFinite(Number(v)); }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number(value) || 0)); }

function scoreSetup({ direction, setupType, setup, context, structures, liquidity, momentum, entry, stop, riskReward, targets = [] }) {
  if (direction !== 'LONG' && direction !== 'SHORT') {
    return { valid: false, score: 0, grade: 'F', confidence: 'LOW', minimumScore: MIN_PUBLISH_SCORE, components: {}, reasons: ['Invalid setup direction'] };
  }

  const expected = direction === 'LONG' ? 'bullish' : 'bearish';
  const macroCount = ['1w', '1d', '4h'].filter((tf) => structures?.[tf]?.direction === expected).length;
  const executionCount = ['1h', '30m'].filter((tf) => structures?.[tf]?.direction === expected).length;
  const momentumCount = ['1h', '30m'].filter((tf) => momentum?.timeframes?.[tf]?.direction === expected).length;
  const directionalTargets = targets.filter((target) => finite(target?.riskReward) && Number(target.riskReward) >= MIN_ACCEPTABLE_RR);
  const externalTargets = targets.filter((target) => target?.liquidityClass === 'external');
  const latestBreak = setup?.break?.event || setup?.break?.b || null;
  const hasBreak = Boolean(latestBreak && finite(latestBreak.level));
  const hasSweep = Boolean(setup?.sweep);
  const riskPct = finite(entry) && finite(stop) && Number(entry) !== 0 ? Math.abs(Number(entry) - Number(stop)) / Math.abs(Number(entry)) : null;
  const rr = finite(riskReward) ? Number(riskReward) : 0;

  // Weights: 20 + 20 + 15 + 15 + 10 + 15 + 5 = 100.
  const components = {
    higherTimeframe: Math.round(clamp(macroCount / 3) * 20),
    executionStructure: Math.round(clamp(executionCount / 2) * 20),
    liquidity: Math.round(clamp((directionalTargets.length ? 0.65 : 0) + (externalTargets.length ? 0.35 : 0) + (hasSweep ? 0.10 : 0)) * 15),
    entryQuality: Math.round(clamp((hasBreak ? 0.55 : 0) + (['RETEST', 'CONTINUATION', 'REVERSAL'].includes(setupType) ? 0.35 : 0)) * 15),
    stopQuality: riskPct === null ? 5 : riskPct <= 0.025 ? 10 : riskPct <= 0.05 ? 8 : 6,
    rewardRR: rr >= 3 ? 15 : rr >= 2.5 ? 13 : rr >= 2 ? 11 : rr >= 1.75 ? 9 : rr >= 1.5 ? 7 : 0,
    momentumContext: Math.round(clamp(momentumCount / 2) * 5),
  };

  let score = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (context?.regime === 'trending' && setupType === 'CONTINUATION') score += 2;
  if (context?.regime === 'transitioning' && setupType === 'REVERSAL') score += 2;
  score = Math.min(MAX_SCORE, Math.max(0, Math.round(score)));

  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const confidence = score >= 85 ? 'HIGH' : score >= 70 ? 'MEDIUM' : 'LOW';
  const valid = score >= MIN_PUBLISH_SCORE && rr >= MIN_ACCEPTABLE_RR && directionalTargets.length > 0;

  const reasons = [
    `${macroCount}/3 higher-timeframe structures support ${direction}`,
    `${executionCount}/2 execution structures support ${direction}`,
  ];
  if (hasBreak) reasons.push(`${latestBreak.kind || 'Structural break'} provides a directional trigger`);
  if (hasSweep) reasons.push('Recent opposing liquidity sweep strengthens the setup');
  if (externalTargets.length) reasons.push('External liquidity provides a meaningful objective');
  reasons.push(momentumCount > 0 ? `${momentumCount}/2 execution momentum readings support direction` : 'Momentum is neutral; structure remains the primary signal');
  if (rr >= MIN_PREFERRED_RR) reasons.push(`${rr.toFixed(2)}R to TP1`);
  else if (rr >= MIN_ACCEPTABLE_RR) reasons.push(`${rr.toFixed(2)}R to TP1; acceptable but below the preferred 2R`);
  else reasons.push('Reward/risk is below the acceptable threshold');

  return {
    valid,
    score,
    grade,
    confidence,
    minimumScore: MIN_PUBLISH_SCORE,
    minimumRiskReward: MIN_ACCEPTABLE_RR,
    preferredRiskReward: MIN_PREFERRED_RR,
    components,
    reasons,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { MIN_RR: MIN_PREFERRED_RR, MIN_SCORE: MIN_PUBLISH_SCORE, MAX_SCORE, scoreSetup };
