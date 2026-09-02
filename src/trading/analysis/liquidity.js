"use strict";

/*
 * LIQUIDITY ENGINE
 *
 * Liquidity is derived from market structure.
 *
 * Responsibilities:
 * - meaningful swing liquidity
 * - EQH / EQL liquidity
 * - internal vs external hierarchy
 * - directional liquidity
 * - nearest meaningful liquidity
 *
 * Does NOT:
 * - choose entries
 * - choose stops
 * - calculate RR
 * - choose trade targets
 */

const TIMEFRAMES = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

const EQUALITY_TOLERANCE = 0.0015;
const MIN_EQUAL_SWING_GAP = 2;

function validPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function getClosedCandles(candles) {
  return (Array.isArray(candles) ? candles : []).filter(
    (candle) =>
      candle &&
      candle.isClosed !== false &&
      validPrice(candle.high) &&
      validPrice(candle.low) &&
      validPrice(candle.close)
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
      const first = highs[i];
      const second = highs[j];

      if (
        Number(second.index) - Number(first.index) <
        MIN_EQUAL_SWING_GAP
      ) {
        continue;
      }

      if (
        relativeDistance(first.price, second.price) <=
        EQUALITY_TOLERANCE
      ) {
        result.push({
          price:
            (Number(first.price) + Number(second.price)) / 2,
          type: "equal_highs",
          side: "buy_side",
          indices: [first.index, second.index],
          time: second.time || first.time,
        });

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
      const first = lows[i];
      const second = lows[j];

      if (
        Number(second.index) - Number(first.index) <
        MIN_EQUAL_SWING_GAP
      ) {
        continue;
      }

      if (
        relativeDistance(first.price, second.price) <=
        EQUALITY_TOLERANCE
      ) {
        result.push({
          price:
            (Number(first.price) + Number(second.price)) / 2,
          type: "equal_lows",
          side: "sell_side",
          indices: [first.index, second.index],
          time: second.time || first.time,
        });

        break;
      }
    }
  }

  return result;
}

function deduplicateLevels(levels) {
  const result = [];

  const sorted = [...levels]
    .filter((level) => validPrice(level?.price))
    .sort(
      (a, b) =>
        Number(a.price) - Number(b.price)
    );

  for (const level of sorted) {
    const existing = result.find(
      (item) =>
        item.side === level.side &&
        relativeDistance(
          item.price,
          level.price
        ) <= EQUALITY_TOLERANCE
    );

    if (!existing) {
      result.push(level);
      continue;
    }

    const priority = {
      equal_highs: 4,
      equal_lows: 4,
      swing_high: 3,
      swing_low: 3,
    };

    if (
      (priority[level.type] || 0) >
      (priority[existing.type] || 0)
    ) {
      Object.assign(existing, level);
    }
  }

  return result;
}

function enrichHierarchy(levels, structure) {
  const external = new Set(
    (structure?.hierarchy?.external || []).map(
      (item) =>
        `${item.type}:${item.index}`
    )
  );

  return levels.map((level) => {
    if (
      level.type === "equal_highs" ||
      level.type === "equal_lows"
    ) {
      const indices = level.indices || [];

      const touchesExternal = indices.some(
        (index) =>
          external.has(`swing_high:${index}`) ||
          external.has(`swing_low:${index}`)
      );

      return {
        ...level,
        liquidityClass: touchesExternal
          ? "external"
          : "internal",
      };
    }

    return {
      ...level,
      liquidityClass: external.has(
        `${level.type}:${level.index}`
      )
        ? "external"
        : "internal",
    };
  });
}

function swingsToLiquidity(structure) {
  const highs = structure?.swings?.highs || [];
  const lows = structure?.swings?.lows || [];

  return [
    ...highs
      .filter((swing) => validPrice(swing.price))
      .map((swing) => ({
        price: Number(swing.price),
        type: "swing_high",
        side: "buy_side",
        index: swing.index,
        time: swing.time,
      })),

    ...lows
      .filter((swing) => validPrice(swing.price))
      .map((swing) => ({
        price: Number(swing.price),
        type: "swing_low",
        side: "sell_side",
        index: swing.index,
        time: swing.time,
      })),
  ];
}

function sortByDistance(levels, price) {
  return [...levels].sort(
    (a, b) =>
      Math.abs(Number(a.price) - Number(price)) -
      Math.abs(Number(b.price) - Number(price))
  );
}

function analyzeLiquidity(
  candles,
  structure,
  currentPrice
) {
  const data = getClosedCandles(candles);

  if (!structure || !validPrice(currentPrice)) {
    return {
      valid: false,
      levels: [],
      buySide: [],
      sellSide: [],
      nearestAbove: null,
      nearestBelow: null,
      counts: {
        total: 0,
        buySide: 0,
        sellSide: 0,
      },
    };
  }

  const swingLiquidity =
    swingsToLiquidity(structure);

  const highs =
    structure?.swings?.highs || [];

  const lows =
    structure?.swings?.lows || [];

  const equalHighs =
    detectEqualHighs(highs);

  const equalLows =
    detectEqualLows(lows);

  const levels = deduplicateLevels(
    enrichHierarchy(
      [
        ...swingLiquidity,
        ...equalHighs,
        ...equalLows,
      ],
      structure
    )
  ).map((level) => ({
    ...level,
    location:
      Number(level.price) > Number(currentPrice)
        ? "above"
        : Number(level.price) < Number(currentPrice)
          ? "below"
          : "at",
  }));

  const buySide = sortByDistance(
    levels.filter(
      (level) =>
        level.side === "buy_side" &&
        Number(level.price) > Number(currentPrice)
    ),
    currentPrice
  );

  const sellSide = sortByDistance(
    levels.filter(
      (level) =>
        level.side === "sell_side" &&
        Number(level.price) < Number(currentPrice)
    ),
    currentPrice
  );

  const above = sortByDistance(
    levels.filter(
      (level) =>
        Number(level.price) > Number(currentPrice)
    ),
    currentPrice
  );

  const below = sortByDistance(
    levels.filter(
      (level) =>
        Number(level.price) < Number(currentPrice)
    ),
    currentPrice
  );

  return {
    valid: data.length >= 20,
    currentPrice: Number(currentPrice),
    levels,
    buySide,
    sellSide,
    nearest: {
      above: above[0] || null,
      below: below[0] || null,
    },

    nearestAbove: above[0] || null,
    nearestBelow: below[0] || null,

    // Canonical directional lookup used by setup detection.
    nearest: {
      above: above[0] || null,
      below: below[0] || null,
    },

    counts: {
      total: levels.length,
      buySide: buySide.length,
      sellSide: sellSide.length,
    },
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
      marketData.timeframes[timeframe]?.candles || [];

    const structure =
      structures?.[timeframe];

    const currentPrice =
      Number(
        marketData.timeframes[timeframe]?.price
      ) ||
      Number(
        marketData.price
      ) ||
      Number(
        candles.at(-1)?.close
      );

    result[timeframe] =
      analyzeLiquidity(
        candles,
        structure,
        currentPrice
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
