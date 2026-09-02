'use strict';

const MIN_SCORE = 75;
const MIN_RR = 2;

function finite(v) { return Number.isFinite(Number(v)); }

function scoreSetup({ direction, structures, liquidity, momentum, riskReward }) {
  if (direction !== 'LONG' && direction !== 'SHORT') return { valid: false, score: 0, grade: 'D', reasons: ['Invalid setup direction'], components: {} };

  const expected = direction === 'LONG' ? 'bullish' : 'bearish';
  const primaryChoch = structures?.['1d']?.breaks?.latest?.kind === 'CHoCH' && structures?.['1d']?.breaks?.latest?.direction === direction;
  const macroAligned = ['1w', '1d', '4h'].filter(tf => structures?.[tf]?.direction === expected).length;
  const executionAligned = ['1h', '30m'].filter(tf => structures?.[tf]?.direction === expected).length;
  const momentumVotes = ['1h', '30m'].filter(tf => momentum?.timeframes?.[tf]?.direction === expected).length;
  const directionalLiquidity = direction === 'LONG' ? liquidity?.['4h']?.buySide?.length || 0 : liquidity?.['4h']?.sellSide?.length || 0;
  const confirmedBreaks = ['1h', '30m'].filter(tf => structures?.[tf]?.breaks?.latest?.direction === direction).length;

  const higherTimeframe = macroAligned === 3 ? 25 : (primaryChoch && structures?.['4h']?.direction === expected ? 25 : Math.round(macroAligned / 3 * 25));
  const components = {
    higherTimeframe,
    structure: Math.round(executionAligned / 2 * 20),
    liquidity: directionalLiquidity > 0 ? 15 : 0,
    momentum: Math.round(momentumVotes / 2 * 15),
    execution: Math.round(confirmedBreaks / 2 * 15),
    riskReward: finite(riskReward) && Number(riskReward) >= MIN_RR ? (Number(riskReward) >= 2.5 ? 10 : 6) : 0,
  };

  const score = Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0));
  const valid = score >= MIN_SCORE && finite(riskReward) && Number(riskReward) >= MIN_RR;
  const reasons = [];
  if (macroAligned === 3) reasons.push('1W/1D/4H structure aligned');
  else if (primaryChoch && structures?.['4h']?.direction === expected) reasons.push('1D CHoCH with 4H directional confirmation');
  if (executionAligned === 2) reasons.push('1H/30M structure aligned');
  else if (executionAligned === 1) reasons.push('One execution timeframe confirms structure');
  if (components.liquidity) reasons.push('Directional liquidity available');
  if (components.momentum >= 8) reasons.push('Execution momentum confirms direction');
  if (components.execution >= 8) reasons.push('Confirmed structural break');
  if (finite(riskReward) && Number(riskReward) >= MIN_RR) reasons.push(`${Number(riskReward).toFixed(2)}R to TP1`);

  return { valid, score, grade: score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D', minimumScore: MIN_SCORE, minimumRiskReward: MIN_RR, components, reasons, generatedAt: new Date().toISOString() };
}

module.exports = { MIN_RR, MIN_SCORE, MAX_SCORE: 100, scoreSetup };
