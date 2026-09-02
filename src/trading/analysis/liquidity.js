'use strict';

const TIMEFRAMES = Object.freeze(['1w', '1d', '4h', '1h', '30m']);
const EQUALITY_TOLERANCE = 0.0015;
const MIN_EQUAL_SWING_GAP = 2;
const SWEEP_LOOKBACK = 80;

function validPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function getClosedCandles(candles) {
  return (Array.isArray(candles) ? candles : []).filter(c =>
    c && c.isClosed !== false && validPrice(c.high) && validPrice(c.low) && validPrice(c.close)
  );
}

function relativeDistance(a, b) {
  if (!validPrice(a) || !validPrice(b)) return Infinity;
  return Math.abs(Number(a) - Number(b)) / Number(b);
}

function detectEqualHighs(highs) {
  const result = [];
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const first = highs[i], second = highs[j];
      if (Number(second.index) - Number(first.index) < MIN_EQUAL_SWING_GAP) continue;
      if (relativeDistance(first.price, second.price) <= EQUALITY_TOLERANCE) {
        result.push({ price: (Number(first.price) + Number(second.price)) / 2, type: 'equal_highs', side: 'buy_side', indices: [first.index, second.index], time: second.time || first.time });
        break;
      }
    }
  }
  return result;
}

function detectEqualLows(lows) {
  const result = [];
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const first = lows[i], second = lows[j];
      if (Number(second.index) - Number(first.index) < MIN_EQUAL_SWING_GAP) continue;
      if (relativeDistance(first.price, second.price) <= EQUALITY_TOLERANCE) {
        result.push({ price: (Number(first.price) + Number(second.price)) / 2, type: 'equal_lows', side: 'sell_side', indices: [first.index, second.index], time: second.time || first.time });
        break;
      }
    }
  }
  return result;
}

function deduplicateLevels(levels) {
  const result = [];
  const priority = { equal_highs: 4, equal_lows: 4, swing_high: 3, swing_low: 3 };
  for (const level of [...levels].filter(l => validPrice(l?.price)).sort((a, b) => Number(a.price) - Number(b.price))) {
    const existing = result.find(item => item.side === level.side && relativeDistance(item.price, level.price) <= EQUALITY_TOLERANCE);
    if (!existing) result.push(level);
    else if ((priority[level.type] || 0) > (priority[existing.type] || 0)) Object.assign(existing, level);
  }
  return result;
}

function enrichHierarchy(levels, structure) {
  const external = new Set((structure?.hierarchy?.external || []).map(item => `${item.type}:${item.index}`));
  return levels.map(level => {
    if (level.type === 'equal_highs' || level.type === 'equal_lows') {
      const touchesExternal = (level.indices || []).some(index => external.has(`swing_high:${index}`) || external.has(`swing_low:${index}`));
      return { ...level, liquidityClass: touchesExternal ? 'external' : 'internal' };
    }
    return { ...level, liquidityClass: external.has(`${level.type}:${level.index}`) ? 'external' : 'internal' };
  });
}

function swingsToLiquidity(structure) {
  return [
    ...(structure?.swings?.highs || []).filter(s => validPrice(s.price)).map(s => ({ price: Number(s.price), type: 'swing_high', side: 'buy_side', index: s.index, time: s.time })),
    ...(structure?.swings?.lows || []).filter(s => validPrice(s.price)).map(s => ({ price: Number(s.price), type: 'swing_low', side: 'sell_side', index: s.index, time: s.time }))
  ];
}

function sortByDistance(levels, price) {
  return [...levels].sort((a, b) => Math.abs(Number(a.price) - Number(price)) - Math.abs(Number(b.price) - Number(price)));
}

function candleAfterIndex(candle, index) {
  return Number(candle.index) > Number(index);
}

function levelWasSwept(level, candles) {
  const start = Math.max(0, candles.length - SWEEP_LOOKBACK);
  const later = candles.slice(start);
  return later.some(candle => {
    if (level.type === 'swing_high' && !candleAfterIndex(candle, level.index)) return false;
    if (level.type === 'swing_low' && !candleAfterIndex(candle, level.index)) return false;
    const price = Number(level.price);
    const high = Number(candle.high), low = Number(candle.low), close = Number(candle.close);
    if (level.side === 'buy_side') return high > price && close < price;
    if (level.side === 'sell_side') return low < price && close > price;
    return false;
  });
}

function detectSweeps(levels, candles) {
  const sweeps = [];
  for (const level of levels) {
    const start = Math.max(0, candles.length - SWEEP_LOOKBACK);
    for (const candle of candles.slice(start)) {
      if ((level.type === 'swing_high' || level.type === 'swing_low') && !candleAfterIndex(candle, level.index)) continue;
      const price = Number(level.price), high = Number(candle.high), low = Number(candle.low), close = Number(candle.close);
      const swept = level.side === 'buy_side' ? high > price && close < price : low < price && close > price;
      if (swept) {
        sweeps.push({ side: level.side, price, type: level.type, level, candleIndex: candle.index, time: candle.time, direction: level.side === 'buy_side' ? 'bearish_rejection' : 'bullish_rejection' });
      }
    }
  }
  return sweeps.sort((a, b) => Number(b.candleIndex || 0) - Number(a.candleIndex || 0));
}

function analyzeLiquidity(candles, structure, currentPrice) {
  const data = getClosedCandles(candles);
  if (!structure || !validPrice(currentPrice)) {
    return { valid: false, levels: [], buySide: [], sellSide: [], nearestAbove: null, nearestBelow: null, sweeps: [], counts: { total: 0, buySide: 0, sellSide: 0, sweeps: 0 } };
  }

  let levels = deduplicateLevels(enrichHierarchy([...swingsToLiquidity(structure), ...detectEqualHighs(structure?.swings?.highs || []), ...detectEqualLows(structure?.swings?.lows || [])], structure));
  levels = levels.map(level => ({ ...level, swept: levelWasSwept(level, data), location: Number(level.price) > Number(currentPrice) ? 'above' : Number(level.price) < Number(currentPrice) ? 'below' : 'at' }));
  const sweeps = detectSweeps(levels, data);
  const buySide = sortByDistance(levels.filter(l => l.side === 'buy_side' && Number(l.price) > Number(currentPrice) && !l.swept), currentPrice);
  const sellSide = sortByDistance(levels.filter(l => l.side === 'sell_side' && Number(l.price) < Number(currentPrice) && !l.swept), currentPrice);
  const above = sortByDistance(levels.filter(l => Number(l.price) > Number(currentPrice) && !l.swept), currentPrice);
  const below = sortByDistance(levels.filter(l => Number(l.price) < Number(currentPrice) && !l.swept), currentPrice);

  return {
    valid: data.length >= 20,
    currentPrice: Number(currentPrice),
    levels,
    buySide,
    sellSide,
    nearestAbove: above[0] || null,
    nearestBelow: below[0] || null,
    sweeps,
    counts: { total: levels.length, buySide: buySide.length, sellSide: sellSide.length, sweeps: sweeps.length }
  };
}

function analyzeAllLiquidity(marketData, structures) {
  if (!marketData?.timeframes) throw new Error('Market data with timeframes is required');
  const result = {};
  for (const timeframe of TIMEFRAMES) {
    const candles = marketData.timeframes[timeframe]?.candles || [];
    const structure = structures?.[timeframe];
    const currentPrice = Number(marketData.timeframes[timeframe]?.price) || Number(marketData.price) || Number(candles.at(-1)?.close);
    result[timeframe] = analyzeLiquidity(candles, structure, currentPrice);
  }
  return result;
}

module.exports = { TIMEFRAMES, EQUALITY_TOLERANCE, detectEqualHighs, detectEqualLows, analyzeLiquidity, analyzeAllLiquidity };
