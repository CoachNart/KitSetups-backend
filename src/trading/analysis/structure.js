"use strict";

/*
 * STRUCTURE ENGINE
 *
 * Reads only closed candles.
 *
 * Responsibilities:
 * - swing highs
 * - swing lows
 * - HH / HL / LH / LL
 * - current structural direction
 * - BOS
 * - CHoCH
 *
 * Does NOT:
 * - choose entries
 * - choose stops
 * - choose targets
 * - calculate RR
 * - score trades
 * - publish signals
 */

const TIMEFRAMES = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

const DEFAULT_SWING_LENGTH = 2;

function isValidCandle(candle) {
  return (
    candle &&
    candle.isClosed !== false &&
    Number.isFinite(Number(candle.high)) &&
    Number.isFinite(Number(candle.low)) &&
    Number.isFinite(Number(candle.close))
  );
}

function getClosedCandles(candles) {
  return (Array.isArray(candles) ? candles : []).filter(
    isValidCandle
  );
}

function findSwingHighs(
  candles,
  strength = DEFAULT_SWING_LENGTH
) {
  const data = getClosedCandles(candles);
  const swings = [];

  for (
    let i = strength;
    i < data.length - strength;
    i++
  ) {
    const high = Number(data[i].high);

    let valid = true;

    for (let j = 1; j <= strength; j++) {
      if (
        high <= Number(data[i - j].high) ||
        high <= Number(data[i + j].high)
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      swings.push({
        type: "swing_high",
        price: high,
        index: i,
        time: data[i].openTime,
      });
    }
  }

  return swings;
}

function findSwingLows(
  candles,
  strength = DEFAULT_SWING_LENGTH
) {
  const data = getClosedCandles(candles);
  const swings = [];

  for (
    let i = strength;
    i < data.length - strength;
    i++
  ) {
    const low = Number(data[i].low);

    let valid = true;

    for (let j = 1; j <= strength; j++) {
      if (
        low >= Number(data[i - j].low) ||
        low >= Number(data[i + j].low)
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      swings.push({
        type: "swing_low",
        price: low,
        index: i,
        time: data[i].openTime,
      });
    }
  }

  return swings;
}

function classifyHighs(swingHighs) {
  const result = [];

  for (let i = 1; i < swingHighs.length; i++) {
    const previous = swingHighs[i - 1];
    const current = swingHighs[i];

    result.push({
      ...current,
      classification:
        current.price > previous.price
          ? "HH"
          : current.price < previous.price
            ? "LH"
            : "EQH",
    });
  }

  return result;
}

function classifyLows(swingLows) {
  const result = [];

  for (let i = 1; i < swingLows.length; i++) {
    const previous = swingLows[i - 1];
    const current = swingLows[i];

    result.push({
      ...current,
      classification:
        current.price > previous.price
          ? "HL"
          : current.price < previous.price
            ? "LL"
            : "EQL",
    });
  }

  return result;
}

function determineDirection(highs, lows) {
  const recentHighs = highs.slice(-3);
  const recentLows = lows.slice(-3);

  const bullishHighs = recentHighs.filter(
    (item) => item.classification === "HH"
  ).length;

  const bullishLows = recentLows.filter(
    (item) => item.classification === "HL"
  ).length;

  const bearishHighs = recentHighs.filter(
    (item) => item.classification === "LH"
  ).length;

  const bearishLows = recentLows.filter(
    (item) => item.classification === "LL"
  ).length;

  if (
    bullishHighs >= 1 &&
    bullishLows >= 1 &&
    bullishHighs + bullishLows >
      bearishHighs + bearishLows
  ) {
    return "bullish";
  }

  if (
    bearishHighs >= 1 &&
    bearishLows >= 1 &&
    bearishHighs + bearishLows >
      bullishHighs + bullishLows
  ) {
    return "bearish";
  }

  return "range";
}

function detectBreaks(
  candles,
  swingHighs,
  swingLows
) {
  const data = getClosedCandles(candles);

  if (!data.length) {
    return {
      bos: null,
      choch: null,
    };
  }

  const lastClose = Number(data.at(-1).close);

  const previousHigh =
    swingHighs.at(-1) || null;

  const previousLow =
    swingLows.at(-1) || null;

  let bos = null;
  let choch = null;

  if (
    previousHigh &&
    lastClose > previousHigh.price
  ) {
    bos = {
      direction: "bullish",
      level: previousHigh.price,
      time: data.at(-1).openTime,
    };
  }

  if (
    previousLow &&
    lastClose < previousLow.price
  ) {
    bos = {
      direction: "bearish",
      level: previousLow.price,
      time: data.at(-1).openTime,
    };
  }

  return {
    bos,
    choch,
  };
}

function analyzeStructure(
  candles,
  options = {}
) {
  const strength =
    Number(options.swingStrength) ||
    DEFAULT_SWING_LENGTH;

  const data = getClosedCandles(candles);

  const swingHighs =
    findSwingHighs(data, strength);

  const swingLows =
    findSwingLows(data, strength);

  const highs =
    classifyHighs(swingHighs);

  const lows =
    classifyLows(swingLows);

  const direction =
    determineDirection(highs, lows);

  const breaks =
    detectBreaks(
      data,
      swingHighs,
      swingLows
    );

  return {
    valid: data.length >= 20,

    direction,

    swings: {
      highs,
      lows,
    },

    latest: {
      high: highs.at(-1) || null,
      low: lows.at(-1) || null,
    },

    breaks,

    candlesAnalyzed: data.length,

    generatedAt:
      new Date().toISOString(),
  };
}

function analyzeAllStructures(marketData) {
  if (!marketData?.timeframes) {
    throw new Error(
      "Market data with timeframes is required"
    );
  }

  const structures = {};

  for (const timeframe of TIMEFRAMES) {
    structures[timeframe] =
      analyzeStructure(
        marketData.timeframes[timeframe]?.candles || []
      );
  }

  return structures;
}

module.exports = {
  TIMEFRAMES,
  findSwingHighs,
  findSwingLows,
  analyzeStructure,
  analyzeAllStructures,
};
