'use strict';
const { createWaitResult } = require('../contract');
const TIMEFRAMES = ['1w', '1d', '4h', '1h', '30m'];

function dir(value) {
  if (value === 'bullish' || value === 'LONG') return 'LONG';
  if (value === 'bearish' || value === 'SHORT') return 'SHORT';
  return null;
}

function wait(symbol, price, reason, context, structures, liquidity, momentum) {
  return createWaitResult({ symbol, price, reasons: [reason], analysis: { context, structures, liquidity, momentum }, stage: 'detector' });
}

function detectSetup({ symbol, price, context, structures, liquidity, momentum }) {
  if (!symbol) throw new Error('symbol is required');

  let direction = dir(context?.bias);
  const primary = structures?.['1d']?.breaks?.latest;
  const primaryBreak = dir(primary?.direction);
  const primaryChoch = primary?.kind === 'CHoCH';
  if (primaryBreak && primaryChoch) direction = primaryBreak;

  if (!direction) return wait(symbol, price, 'No reliable higher-timeframe directional bias', context, structures, liquidity, momentum);
  if (!TIMEFRAMES.every(tf => structures?.[tf]?.valid)) return wait(symbol, price, 'Insufficient closed-candle data for the structural hierarchy', context, structures, liquidity, momentum);

  const expected = direction === 'LONG' ? 'bullish' : 'bearish';
  const intermediateConfirmed = structures['4h']?.direction === expected;
  const primaryConfirmed = structures['1d']?.direction === expected || primaryChoch;
  if (!intermediateConfirmed || !primaryConfirmed) return wait(symbol, price, `Higher-timeframe structure does not confirm ${direction}`, context, structures, liquidity, momentum);

  const oneHourMomentum = momentum?.timeframes?.['1h'];
  const thirtyMomentum = momentum?.timeframes?.['30m'];
  if (!oneHourMomentum?.sufficientData || !thirtyMomentum?.sufficientData) return wait(symbol, price, 'Insufficient momentum data on execution timeframes', context, structures, liquidity, momentum);
  if (oneHourMomentum.direction !== expected && thirtyMomentum.direction !== expected) return wait(symbol, price, `Execution momentum does not confirm ${expected} direction`, context, structures, liquidity, momentum);

  if (primaryChoch) {
    const opposingSweep = direction === 'LONG' ? 'sell_side' : 'buy_side';
    const swept = ['1h', '30m'].some(tf => (liquidity?.[tf]?.sweeps || []).some(sweep => sweep.side === opposingSweep));
    if (!swept) return wait(symbol, price, `CHoCH ${direction} lacks a confirmed opposing liquidity sweep`, context, structures, liquidity, momentum);
  }

  const trade = structures['1h'], execution = structures['30m'];
  const tradeBreak = dir(trade?.breaks?.latest?.direction) === direction;
  const executionBreak = dir(execution?.breaks?.latest?.direction) === direction;
  if (!tradeBreak && !executionBreak) return wait(symbol, price, `1H/30M structure has no confirmed ${direction} BOS/CHoCH confirmation`, context, structures, liquidity, momentum);

  const levels = direction === 'LONG' ? liquidity?.['4h']?.buySide : liquidity?.['4h']?.sellSide;
  if (!Array.isArray(levels) || !levels.length) return wait(symbol, price, direction === 'LONG' ? 'No genuine buy-side liquidity remains above price' : 'No genuine sell-side liquidity remains below price', context, structures, liquidity, momentum);

  return {
    symbol,
    price: Number(price),
    detected: true,
    direction,
    evidence: {
      contextBias: context.bias,
      macro: structures['1w'].direction,
      primary: structures['1d'].direction,
      intermediate: structures['4h'].direction,
      trade: trade.direction,
      execution: execution.direction,
    },
    confirmation: { tradeBreak, executionBreak, primaryChoch },
    reasons: [`${direction} structure and momentum confirmed`, 'Directional liquidity remains available'],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { detectSetup };
