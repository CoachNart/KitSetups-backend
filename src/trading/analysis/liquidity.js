"use strict";

/*
 * LIQUIDITY ENGINE
 *
 * Reads structure and closed candles.
 *
 * Responsibilities:
 * - buy-side liquidity
 * - sell-side liquidity
 * - swing liquidity
 * - equal highs / equal lows
 * - internal vs external liquidity
 * - nearest liquidity
 *
 * Does NOT:
 * - generate entries
 * - generate stops
 * - generate targets
 * - score setups
 * - publish signals
 */

const TIMEFRAMES = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

const EQUALITY_TOLERANCE = 0.0015;

function validPrice(value) {
  return Number.isFinite(Number(value)) &&
    Number(value) > 0;
}

function getClosedCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .filter(
      (candle) =>
        candle &&
        candle.isClosed !== false &&
        validPrice(candle.high) &&
        validPrice(candle.low)
    );
}

function relativeDistance(a, b) {
  if (!validPrice(a) || !validPrice(b)) {
    return Infinity;
  }

  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}

function detectEqualHighs(candles) {
  const data = getClosedCandles(candles);
  const levels = [];

  for (let i = 1; i < data.length; i++) {
    const previous = Number(data[i - 1].high);
    const current = Number(data[i].high);

    if (
      relativeDistance(previous, current) <=
      EQUALITY_TOLERANCE
    ) {
      levels.push({
        price: Number(
          ((previous + current) / 2).toFixed(12)
        ),
        side: "buy_side",
        type: "equal_highs",
        firstIndex: i - 1,
        secondIndex: i,
        firstTime: data[i - 1].openTime,
        secondTime: data[i].openTime,
      });
    }
  }

  return levels;
}

function detectEqualLows(candles) {
  const data = getClosedCandles(candles);
  const levels = [];

  for (let i = 1; i < data.length; i++) {
    const previous = Number(data[i - 1].low);
    const current = Number(data[i].low);

    if (
      relativeDistance(previous, current) <=
      EQUALITY_TOLERANCE
    ) {
      levels.push({
        price: Number(
          ((previous + current) / 2).toFixed(12)
        ),
        side: "sell_side",
        type: "equal_lows",
        firstIndex: i - 1,
        secondIndex: i,
        firstTime: data[i - 1].openTime,
        secondTime: data[i].openTime,
      });
    }
  }

  return levels;
}

function swingsToLiquidity(
  structure,
  candles
) {
  const data = getClosedCandles(candles);

  const highestIndex =
    Math.max(0, data.length - 1);

  const result = [];

  const highs =
    structure?.swings?.highs || [];

  const lows =
    structure?.swings?.lows || [];

  for (const swing of highs) {
    if (!validPrice(swing.price)) {
      continue;
    }

    /*
     * Older major swings are treated as external.
     * More recent swings are internal.
     */
    const age =
      highestIndex - Number(swing.index || 0);

    result.push({
      price: Number(swing.price),
      type: "swing_high",
      side: "buy_side",
      index: swing.index,
      time: swing.time,
      liquidityClass:
        age >= data.length * 0.35
          ? "external"
          : "internal",
    });
  }

  for (const swing of lows) {
    if (!validPrice(swing.price)) {
      continue;
    }

    const age =
      highestIndex - Number(swing.index || 0);

    result.push({
      price: Number(swing.price),
      type: "swing_low",
      side: "sell_side",
      index: swing.index,
      time: swing.time,
      liquidityClass:
        age >= data.length * 0.35
          ? "external"
          : "internal",
    });
  }

  return result;
}

function deduplicateLevels(levels) {
  const output = [];

  for (const level of levels) {
    const duplicate = output.find(
      (existing) =>
        existing.side === level.side &&
        relativeDistance(
          existing.price,
          level.price
        ) <= EQUALITY_TOLERANCE
    );

    if (!duplicate) {
      output.push(level);
    }
  }

  return output;
}

function sortByDistance(levels, price) {
  return [...levels].sort(
    (a, b) =>
      Math.abs(a.price - price) -
      Math.abs(b.price - price)
  );
}

function analyzeLiquidity(
  candles,
  structure,
  currentPrice
) {
  const data = getClosedCandles(candles);

  const price = Number(currentPrice);

  const swingLiquidity =
    swingsToLiquidity(
      structure,
      data
    );

  const equalHighs =
    detectEqualHighs(data);

  const equalLows =
    detectEqualLows(data);

  const allLevels =
    deduplicateLevels([
      ...swingLiquidity,
      ...equalHighs,
      ...equalLows,
    ]).map((level) => ({
      ...level,

      location:
        level.price > price
          ? "above"
          : level.price < price
            ? "below"
            : "at_price",
    }));

  const buySide =
    allLevels.filter(
      (level) =>
        level.side === "buy_side"
    );

  const sellSide =
    allLevels.filter(
      (level) =>
        level.side === "sell_side"
    );

  return {
    valid:
      data.length >= 20 &&
      validPrice(price),

    currentPrice: price,

    buySide: sortByDistance(
      buySide,
      price
    ),

    sellSide: sortByDistance(
      sellSide,
      price
    ),

    all: sortByDistance(
      allLevels,
      price
    ),

    nearest: {
      above:
        sortByDistance(
          allLevels.filter(
            (level) =>
              level.price > price
          ),
          price
        )[0] || null,

      below:
        sortByDistance(
          allLevels.filter(
            (level) =>
              level.price < price
          ),
          price
        )[0] || null,
    },

    counts: {
      total: allLevels.length,
      buySide: buySide.length,
      sellSide: sellSide.length,
    },

    generatedAt:
      new Date().toISOString(),
  };
}

function analyzeAllLiquidity(
  marketData,
  structures
) {
  if (!marketData?.timeframes) {
    throw new Error(
      "Market data with timeframes is required"
    );
  }

  const result = {};

  for (const timeframe of TIMEFRAMES) {
    const candles =
      marketData.timeframes[timeframe]?.candles ||
      [];

    result[timeframe] =
      analyzeLiquidity(
        candles,
        structures?.[timeframe],
        marketData.ticker?.lastPrice
      );
  }

  return result;
}

module.exports = {
  TIMEFRAMES,
  EQUALITY_TOLERANCE,
  detectEqualHighs,
  detectEqualLows,
  analyzeLiquidity,
  analyzeAllLiquidity,
};
