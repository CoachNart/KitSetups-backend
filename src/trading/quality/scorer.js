'use strict';

const MAX_SCORE = 100;
const MIN_PUBLISH_SCORE = 70;
const MIN_PREFERRED_RR = 2;
const MIN_ACCEPTABLE_RR = 1.5;

function finite(v) {
  return Number.isFinite(Number(v));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function scoreSetup({
  direction,
  setupType,
  setup,
  context,
  structures,
  liquidity,
  momentum,
  riskReward,
  targets = [],
}) {
  if (direction !== 'LONG' && direction !== 'SHORT') {
    return {
      valid: false,
      score: 0,
      grade: 'F',
      confidence: 'Low',
      minimumScore: MIN_PUBLISH_SCORE,
      components: {},
      reasons: ['Invalid setup direction'],
    };
  }

  const expected = direction === 'LONG' ? 'bullish' : 'bearish';
  const macroCount = ['1w', '1d', '4h'].filter((tf) => structures?.[tf]?.direction === expected).length;
  const executionCount = ['1h', '30m'].filter((tf) => structures?.[tf]?.direction === expected).length;
  const momentumCount = ['1h', '30m'].filter((tf) => momentum?.timeframes?.[tf]?.direction === expected).length;

  const directionalTargets = targets.filter((target) => {
    const rr = Number(target?.riskReward);
    return finite(rr) && rr >= MIN_ACCEPTABLE_RR;
  });
  const externalTargets = targets.filter((target) => target?.liquidityClass === 'external');
  const latestBreak = setup?.break?.event || setup?.break?.b || null;
  const hasBreak = Boolean(latestBreak && finite(latestBreak.level));
  const hasSweep = Boolean(setup?.sweep);
  const contextAligned = context?.bias === expected;
  const regimeKnown = Boolean(context?.regime && context.regime !== 'unknown');

  // Weights intentionally sum to exactly 100. Missing secondary evidence lowers
  // the component; it never becomes a hard rejection by itself.
  const higherTimeframe = Math.round(clamp(macroCount / 3) * 20);
  const executionStructure = Math.round(clamp(executionCount / 2) * 20);

  let liquidityBase = directionalTargets.length ? 0.65 : 0;
  if (externalTargets.length) liquidityBase += 0.35;
  if (hasSweep) liquidityBase += 0.10;
  const liquidity = Math.round(clamp(liquidityBase) * 15);

  let entryBase = 0;
  if (hasBreak) entryBase += 0.55;
  if (setupType === 'RETEST' || setup?.type === 'RETEST') entryBase += 0.30;
  if (setupType === 'CONTINUATION' || setup?.type === 'CONTINUATION') entryBase += 0.20;
  if (setupType === 'REVERSAL' || setup?.type === 'REVERSAL') entryBase += 0.15;
  const entryQuality = Math.round(clamp(entryBase) * 15);

  const stopDistance = setup?.stopDistance || null;
  const riskPct = finite(stopDistance) ? Number(stopDistance) : null;
  const stopQuality = riskPct === null
    ? 7
    : riskPct <= 0.025
      ? 10
      : riskPct <= 0.05
        ? 8
        : 6;

  const rr = finite(riskReward) ? Number(riskReward) : 0;
  const rewardScore = rr >= 3 ? 15 : rr >= 2.5 ? 13 : rr >= 2 ? 11 : rr >= 1.75 ? 9 : rr >= 1.5 ? 7 : 0;
  const momentumScore = Math.round(clamp(momentumCount / 2) * 5);

  // Risk/stop quality and reward are kept independent: a good RR cannot hide a
  // nonsensical stop, and a neutral momentum reading does not kill structure.
  const components = {
    higherTimeframe,
    executionStructure,
    liquidity,
    entryQuality,
    stopQuality,
    rewardRR: rewardScore,
    momentumContext: momentumScore,
  };

  let score = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (contextAligned) score += 0; // already represented by higher-timeframe structure
  if (regimeKnown && context.regime === 'trending' && (setupType === 'CONTINUATION' || setup?.type === 'CONTINUATION')) score = Math.min(MAX_SCORE, score + 2);
  if (regimeKnown && context.regime === 'transitioning' && (setupType === 'REVERSAL' || setup?.type === 'REVERSAL')) score = Math.min(MAX_SCORE, score + 2);
  score = Math.min(MAX_SCORE, Math.max(0, Math.round(score)));

  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const confidence = score >= 85 ? 'HIGH' : score >= 70 ? 'MEDIUM' : 'LOW';
  const valid = score >= MIN_PUBLISH_SCORE && rr >= MIN_ACCEPTABLE_RR && directionalTargets.length > 0;

  const reasons = [];
  reasons.push(`${macroCount}/3 higher-timeframe structures support ${direction}`);
  reasons.push(`${executionCount}/2 execution structures support ${direction}`);
  if (hasBreak) reasons.push(`${latestBreak.kind || 'Structural break'} provides a directional trigger`);
  if (hasSweep) reasons.push('Recent opposing liquidity sweep strengthens the setup');
  if (externalTargets.length) reasons.push('External liquidity provides a meaningful objective');
  if (momentumCount > 0) reasons.push(`${momentumCount}/2 execution momentum readings support direction`);
  else reasons.push('Momentum is neutral; structure remains the primary signal');
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

module.exports = {
  MIN_RR: MIN_PREFERRED_RR,
  MIN_SCORE: MIN_PUBLISH_SCORE,
  MAX_SCORE,
  scoreSetup,
};
