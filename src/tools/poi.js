"use strict";

/*
 * KITSETUPS — POINT OF INTEREST ENGINE
 *
 * Purpose:
 * Detect high-quality execution POIs from closed candles.
 *
 * POI types:
 * - bullish_order_block
 * - bearish_order_block
 * - bullish_fvg
 * - bearish_fvg
 *
 * The engine does NOT create a trade by itself.
 * POIs are only valid candidates for the later:
 *
 * SWEEP → DISPLACEMENT → BOS/CHoCH → RETEST → ENTRY
 */

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function closedCandles(candles = []) {
  return candles.filter(
    candle => candle && candle.isClosed !== false
  );
}

function candleDirection(candle) {
  const open = finite(candle?.open);
  const close = finite(candle?.close);

  if (open === null || close === null) {
    return null;
  }

  if (close > open) return "bullish";
  if (close < open) return "bearish";

  return "neutral";
}

function candleRange(candle) {
  const high = finite(candle?.high);
  const low = finite(candle?.low);

  if (high === null || low === null) {
    return null;
  }

  return high - low;
}

function bodySize(candle) {
  const open = finite(candle?.open);
  const close = finite(candle?.close);

  if (open === null || close === null) {
    return null;
  }

  return Math.abs(close - open);
}

function averageRange(candles, endIndex, lookback = 20) {
  const start = Math.max(
    0,
    endIndex - lookback
  );

  const ranges = [];

  for (let i = start; i < endIndex; i++) {
    const range = candleRange(candles[i]);

    if (range !== null && range > 0) {
      ranges.push(range);
    }
  }

  if (!ranges.length) {
    return null;
  }

  return (
    ranges.reduce(
      (sum, value) => sum + value,
      0
    ) / ranges.length
  );
}

function isDisplacementCandle(
  candles,
  index,
  direction
) {
  const candle = candles[index];

  const range = candleRange(candle);
  const body = bodySize(candle);
  const average = averageRange(
    candles,
    index,
    20
  );

  if (
    range === null ||
    body === null ||
    average === null ||
    average <= 0
  ) {
    return false;
  }

  const actualDirection =
    candleDirection(candle);

  if (actualDirection !== direction) {
    return false;
  }

  const bodyRatio = body / range;
  const rangeMultiple = range / average;

  return (
    bodyRatio >= 0.55 &&
    rangeMultiple >= 1.25
  );
}

/*
 * Detect a bullish order block.
 *
 * Definition used here:
 * The last meaningful bearish candle immediately
 * preceding a strong bullish displacement candle.
 */
function detectBullishOrderBlock(
  candles,
  index
) {
  if (index < 1) {
    return null;
  }

  const displacement =
    candles[index];

  const origin =
    candles[index - 1];

  if (
    candleDirection(origin) !== "bearish"
  ) {
    return null;
  }

  if (
    !isDisplacementCandle(
      candles,
      index,
      "bullish"
    )
  ) {
    return null;
  }

  const high = finite(origin.high);
  const low = finite(origin.low);

  if (
    high === null ||
    low === null ||
    high <= low
  ) {
    return null;
  }

  return {
    type: "bullish_order_block",
    direction: "bullish",
    high,
    low,
    midpoint: Number(
      ((high + low) / 2).toFixed(2)
    ),
    originCandle: origin.openTime,
    confirmationCandle: displacement.openTime
  };
}

/*
 * Detect a bearish order block.
 */
function detectBearishOrderBlock(
  candles,
  index
) {
  if (index < 1) {
    return null;
  }

  const displacement =
    candles[index];

  const origin =
    candles[index - 1];

  if (
    candleDirection(origin) !== "bullish"
  ) {
    return null;
  }

  if (
    !isDisplacementCandle(
      candles,
      index,
      "bearish"
    )
  ) {
    return null;
  }

  const high = finite(origin.high);
  const low = finite(origin.low);

  if (
    high === null ||
    low === null ||
    high <= low
  ) {
    return null;
  }

  return {
    type: "bearish_order_block",
    direction: "bearish",
    high,
    low,
    midpoint: Number(
      ((high + low) / 2).toFixed(2)
    ),
    originCandle: origin.openTime,
    confirmationCandle: displacement.openTime
  };
}

/*
 * Fair Value Gap.
 *
 * Bullish:
 * current candle low > candle two positions earlier high
 *
 * Bearish:
 * current candle high < candle two positions earlier low
 */
function detectFVG(
  candles,
  index
) {
  if (index < 2) {
    return [];
  }

  const left =
    candles[index - 2];

  const middle =
    candles[index - 1];

  const right =
    candles[index];

  const leftHigh = finite(left?.high);
  const leftLow = finite(left?.low);

  const rightHigh = finite(right?.high);
  const rightLow = finite(right?.low);

  if (
    leftHigh === null ||
    leftLow === null ||
    rightHigh === null ||
    rightLow === null
  ) {
    return [];
  }

  const result = [];

  /*
   * Bullish FVG
   */
  if (rightLow > leftHigh) {
    result.push({
      type: "bullish_fvg",
      direction: "bullish",
      high: rightLow,
      low: leftHigh,
      midpoint: Number(
        ((rightLow + leftHigh) / 2).toFixed(2)
      ),
      startCandle: left.openTime,
      confirmationCandle: right.openTime,
      size: Number(
        (rightLow - leftHigh).toFixed(2)
      )
    });
  }

  /*
   * Bearish FVG
   */
  if (rightHigh < leftLow) {
    result.push({
      type: "bearish_fvg",
      direction: "bearish",
      high: leftLow,
      low: rightHigh,
      midpoint: Number(
        ((leftLow + rightHigh) / 2).toFixed(2)
      ),
      startCandle: left.openTime,
      confirmationCandle: right.openTime,
      size: Number(
        (leftLow - rightHigh).toFixed(2)
      )
    });
  }

  return result;
}

function isPriceInsidePOI(
  price,
  poi
) {
  const p = finite(price);
  const high = finite(poi?.high);
  const low = finite(poi?.low);

  if (
    p === null ||
    high === null ||
    low === null
  ) {
    return false;
  }

  return p >= low && p <= high;
}

function distanceToPOI(
  price,
  poi
) {
  const p = finite(price);
  const high = finite(poi?.high);
  const low = finite(poi?.low);

  if (
    p === null ||
    high === null ||
    low === null
  ) {
    return null;
  }

  if (p >= low && p <= high) {
    return 0;
  }

  if (p < low) {
    return low - p;
  }

  return p - high;
}

function findNearestPOIs(
  pois,
  price,
  direction
) {
  const candidates = pois
    .filter(
      poi =>
        poi?.direction === direction
    )
    .map(poi => ({
      ...poi,
      distance: distanceToPOI(
        price,
        poi
      )
    }))
    .filter(
      poi =>
        poi.distance !== null
    )
    .sort(
      (a, b) =>
        a.distance - b.distance
    );

  return candidates;
}

function analyzePOI(
  candles = [],
  price = null,
  direction = null
) {
  const closed =
    closedCandles(candles);

  if (closed.length < 10) {
    return {
      available: false,
      reason: "Not enough closed candles",
      bullish: [],
      bearish: [],
      nearest: null
    };
  }

  const orderBlocks = [];
  const fvgs = [];

  /*
   * Scan recent history only.
   * This prevents extremely old POIs from
   * dominating current execution.
   */
  const start =
    Math.max(
      2,
      closed.length - 80
    );

  for (
    let i = start;
    i < closed.length;
    i++
  ) {
    const bullishOB =
      detectBullishOrderBlock(
        closed,
        i
      );

    if (bullishOB) {
      orderBlocks.push(
        bullishOB
      );
    }

    const bearishOB =
      detectBearishOrderBlock(
        closed,
        i
      );

    if (bearishOB) {
      orderBlocks.push(
        bearishOB
      );
    }

    const gaps =
      detectFVG(
        closed,
        i
      );

    fvgs.push(...gaps);
  }

  const allPOIs = [
    ...orderBlocks,
    ...fvgs
  ];

  /*
   * Keep only the most recent POIs.
   */
  const recent =
    allPOIs.slice(-30);

  const bullish =
    recent.filter(
      poi =>
        poi.direction === "bullish"
    );

  const bearish =
    recent.filter(
      poi =>
        poi.direction === "bearish"
    );

  let nearest = null;

  if (
    direction === "bullish" ||
    direction === "bearish"
  ) {
    nearest =
      findNearestPOIs(
        recent,
        price,
        direction
      )[0] || null;
  }

  return {
    available: recent.length > 0,
    total: recent.length,

    bullish,
    bearish,

    nearest,

    price: finite(price),

    insidePOI:
      nearest
        ? isPriceInsidePOI(
            price,
            nearest
          )
        : false
  };
}

function getBestPOI(
  analysis,
  direction
) {
  if (!analysis) {
    return null;
  }

  const candidates =
    direction === "bullish"
      ? analysis.bullish || []
      : direction === "bearish"
        ? analysis.bearish || []
        : [];

  if (!candidates.length) {
    return null;
  }

  /*
   * Prefer order blocks over FVGs,
   * then prefer the most recent candidate.
   */
  const sorted =
    [...candidates].sort(
      (a, b) => {
        const aOB =
          a.type.includes(
            "order_block"
          )
            ? 1
            : 0;

        const bOB =
          b.type.includes(
            "order_block"
          )
            ? 1
            : 0;

        if (aOB !== bOB) {
          return bOB - aOB;
        }

        return String(
          b.confirmationCandle || ""
        ).localeCompare(
          String(
            a.confirmationCandle || ""
          )
        );
      }
    );

  return sorted[0] || null;
}

module.exports = {
  finite,
  closedCandles,
  candleDirection,
  candleRange,
  bodySize,
  isDisplacementCandle,
  detectBullishOrderBlock,
  detectBearishOrderBlock,
  detectFVG,
  isPriceInsidePOI,
  distanceToPOI,
  findNearestPOIs,
  analyzePOI,
  getBestPOI
};
