"use strict";

/*
 * STRUCTURE ENGINE
 *
 * Reads only closed candles.
 *
 * Responsibilities:
 * - swing highs / lows
 * - HH / HL / LH / LL / EQH / EQL
 * - internal vs external structure
 * - structural direction
 * - BOS / CHoCH
 * - protected highs / lows
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

  for (let i = 0; i < swingHighs.length; i++) {
    const current = swingHighs[i];
    const previous = swingHighs[i - 1] || null;

    let classification = "SH";

    if (previous) {
      classification =
        current.price > previous.price
          ? "HH"
          : current.price < previous.price
            ? "LH"
            : "EQH";
    }

    result.push({
      ...current,
      classification,
      side: "buy_side",
    });
  }

  return result;
}

function classifyLows(swingLows) {
  const result = [];

  for (let i = 0; i < swingLows.length; i++) {
    const current = swingLows[i];
    const previous = swingLows[i - 1] || null;

    let classification = "SL";

    if (previous) {
      classification =
        current.price > previous.price
          ? "HL"
          : current.price < previous.price
            ? "LL"
            : "EQL";
    }

    result.push({
      ...current,
      classification,
      side: "sell_side",
    });
  }

  return result;
}

/*
 * Determine the dominant structural direction from the most
 * recent confirmed high/low sequence.
 */
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

/*
 * A structural break is confirmed only when the latest closed
 * candle closes beyond a confirmed swing.
 *
 * The swing immediately preceding that break becomes the
 * protected opposing structure.
 */
function detectBreaks(
  candles,
  swingHighs,
  swingLows,
  priorDirection = "range"
) {
  const data = getClosedCandles(candles);

  if (!data.length) {
    return {
      bos: null,
      choch: null,
    };
  }

  const lastClose = Number(data.at(-1).close);

  const latestHigh =
    swingHighs.at(-1) || null;

  const latestLow =
    swingLows.at(-1) || null;

  let bos = null;
  let choch = null;

  if (
    latestHigh &&
    lastClose > latestHigh.price
  ) {
    const protectedLow =
      swingLows
        .filter(
          (swing) =>
            swing.index < latestHigh.index
        )
        .at(-1) || null;

    const breakDirection = "bullish";

    if (priorDirection === "bearish") {
      choch = {
        direction: breakDirection,
        level: latestHigh.price,
        time: data.at(-1).openTime,
        protectedLow,
      };
    } else {
      bos = {
        direction: breakDirection,
        level: latestHigh.price,
        time: data.at(-1).openTime,
        protectedLow,
      };
    }
  }

  if (
    latestLow &&
    lastClose < latestLow.price
  ) {
    const protectedHigh =
      swingHighs
        .filter(
          (swing) =>
            swing.index < latestLow.index
        )
        .at(-1) || null;

    const breakDirection = "bearish";

    if (priorDirection === "bullish") {
      choch = {
        direction: breakDirection,
        level: latestLow.price,
        time: data.at(-1).openTime,
        protectedHigh,
      };
    } else {
      bos = {
        direction: breakDirection,
        level: latestLow.price,
        time: data.at(-1).openTime,
        protectedHigh,
      };
    }
  }

  return {
    bos,
    choch,
  };
}

/*
 * Build the structural hierarchy.
 *
 * External structure:
 * - the major swing forming the outer boundary of the
 *   current structural range / leg.
 *
 * Internal structure:
 * - confirmed swings occurring inside that outer range.
 *
 * This is deliberately based on the current structural leg,
 * not candle age.
 */
function buildHierarchy(highs, lows, direction) {
  const all = [
    ...highs.map((item) => ({
      ...item,
      side: "buy_side",
    })),
    ...lows.map((item) => ({
      ...item,
      side: "sell_side",
    })),
  ].sort((a, b) => a.index - b.index);

  if (!all.length) {
    return {
      internal: [],
      external: [],
    };
  }

  const latestHigh =
    highs.at(-1) || null;

  const latestLow =
    lows.at(-1) || null;

  let externalHigh = latestHigh;
  let externalLow = latestLow;

  if (direction === "bullish") {
    externalLow =
      lows
        .filter(
          (item) =>
            item.classification === "HL" ||
            item.classification === "SL"
        )
        .at(-1) || latestLow;
  }

  if (direction === "bearish") {
    externalHigh =
      highs
        .filter(
          (item) =>
            item.classification === "LH" ||
            item.classification === "SH"
        )
        .at(-1) || latestHigh;
  }

  const externalKeys = new Set();

  if (externalHigh) {
    externalKeys.add(
      `high:${externalHigh.index}`
    );
  }

  if (externalLow) {
    externalKeys.add(
      `low:${externalLow.index}`
    );
  }

  const external = [];
  const internal = [];

  for (const item of all) {
    const key =
      `${item.type === "swing_high" ? "high" : "low"}:${item.index}`;

    const enriched = {
      ...item,
      liquidityClass:
        externalKeys.has(key)
          ? "external"
          : "internal",
    };

    if (externalKeys.has(key)) {
      external.push(enriched);
    } else {
      internal.push(enriched);
    }
  }

  return {
    internal,
    external,
  };
}

function analyzeStructure(
  candles,
  options = {}
) {
  const strength =
    Number(options.swingStrength) ||
    DEFAULT_SWING_LENGTH;

  const data =
    getClosedCandles(candles);

  const rawSwingHighs =
    findSwingHighs(data, strength);

  const rawSwingLows =
    findSwingLows(data, strength);

  const highs =
    classifyHighs(rawSwingHighs);

  const lows =
    classifyLows(rawSwingLows);

  const direction =
    determineDirection(highs, lows);

  const breaks =
    detectBreaks(
      data,
      rawSwingHighs,
      rawSwingLows,
      direction
    );

  const hierarchy =
    buildHierarchy(
      highs,
      lows,
      direction
    );

  const protectedLow =
    breaks?.bos?.protectedLow ||
    breaks?.choch?.protectedLow ||
    (
      direction === "bullish"
        ? hierarchy.external
            .filter(
              (item) =>
                item.side === "sell_side"
            )
            .at(-1)
        : lows.at(-1)
    ) ||
    null;

  const protectedHigh =
    breaks?.bos?.protectedHigh ||
    breaks?.choch?.protectedHigh ||
    (
      direction === "bearish"
        ? hierarchy.external
            .filter(
              (item) =>
                item.side === "buy_side"
            )
            .at(-1)
        : highs.at(-1)
    ) ||
    null;

  return {
    valid: data.length >= 20,

    direction,

    swings: {
      highs,
      lows,
    },

    hierarchy,

    latest: {
      high: highs.at(-1) || null,
      low: lows.at(-1) || null,
    },

    breaks,

    protectedLow,
    protectedHigh,

    candlesAnalyzed:
      data.length,

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
        marketData.timeframes[
          timeframe
        ]?.candles || []
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
