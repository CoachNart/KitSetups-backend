function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function uniqueSorted(levels, direction = "asc") {
  const values = levels
    .map(finite)
    .filter(x => x !== null);

  const unique = [...new Set(values)];

  return unique.sort(
    direction === "desc"
      ? (a, b) => b - a
      : (a, b) => a - b
  );
}

function getSwingLevels(structure = {}) {
  const highs = [
    ...(structure.swingHighs || [])
  ]
    .map(x => finite(x?.price))
    .filter(x => x !== null);

  const lows = [
    ...(structure.swingLows || [])
  ]
    .map(x => finite(x?.price))
    .filter(x => x !== null);

  return {
    highs: uniqueSorted(highs, "asc"),
    lows: uniqueSorted(lows, "asc")
  };
}

function findEqualLevels(
  levels = [],
  tolerancePercent = 0.0015
) {
  const result = [];

  const sorted =
    uniqueSorted(levels, "asc");

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      const midpoint =
        (a + b) / 2;

      if (!midpoint) continue;

      const distance =
        Math.abs(a - b) / midpoint;

      if (
        distance <= tolerancePercent
      ) {
        result.push({
          low: a,
          high: b,
          midpoint: Number(
            midpoint.toFixed(2)
          ),
          distancePercent: Number(
            (distance * 100).toFixed(4)
          )
        });
      }
    }
  }

  return result;
}

function getLiquidityLevels(
  structure = {}
) {
  const {
    highs,
    lows
  } = getSwingLevels(structure);

  const equalHighs =
    findEqualLevels(highs);

  const equalLows =
    findEqualLevels(lows);

  return {
    buySide: [
      ...highs.map(price => ({
        type: "swing_high",
        price
      })),

      ...equalHighs.map(level => ({
        type: "equal_high",
        price: level.midpoint,
        low: level.low,
        high: level.high
      }))
    ],

    sellSide: [
      ...lows.map(price => ({
        type: "swing_low",
        price
      })),

      ...equalLows.map(level => ({
        type: "equal_low",
        price: level.midpoint,
        low: level.low,
        high: level.high
      }))
    ],

    equalHighs,
    equalLows
  };
}

function nearestAbove(
  levels,
  price
) {
  const p = finite(price);

  if (p === null) return null;

  return levels
    .map(x => finite(x?.price ?? x))
    .filter(
      x => x !== null && x > p
    )
    .sort((a, b) => a - b)[0] || null;
}

function nearestBelow(
  levels,
  price
) {
  const p = finite(price);

  if (p === null) return null;

  return levels
    .map(x => finite(x?.price ?? x))
    .filter(
      x => x !== null && x < p
    )
    .sort((a, b) => b - a)[0] || null;
}

function detectSweeps(
  candles = [],
  liquidity = {}
) {
  const closed =
    candles.filter(
      c => c?.isClosed !== false
    );

  const buySide =
    liquidity.buySide || [];

  const sellSide =
    liquidity.sellSide || [];

  const sweeps = [];

  for (const candle of closed) {
    const high =
      finite(candle?.high);

    const low =
      finite(candle?.low);

    const close =
      finite(candle?.close);

    if (
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    for (const level of buySide) {
      const price =
        finite(level.price);

      if (
        price !== null &&
        high > price &&
        close < price
      ) {
        sweeps.push({
          direction: "bearish",
          liquiditySide: "buy_side",
          type: level.type,
          level: price,
          candle: candle.openTime
        });
      }
    }

    for (const level of sellSide) {
      const price =
        finite(level.price);

      if (
        price !== null &&
        low < price &&
        close > price
      ) {
        sweeps.push({
          direction: "bullish",
          liquiditySide: "sell_side",
          type: level.type,
          level: price,
          candle: candle.openTime
        });
      }
    }
  }

  return sweeps;
}

function analyzeLiquidity(
  timeframeData = {}
) {
  const structure =
    timeframeData.structure || {};

  const candles =
    timeframeData.candles || [];

  const levels =
    getLiquidityLevels(structure);

  const latest =
    candles
      .filter(
        c => c?.isClosed !== false
      )
      .at(-1);

  const price =
    finite(
      latest?.close
    );

  const nearestBuySide =
    nearestAbove(
      levels.buySide,
      price
    );

  const nearestSellSide =
    nearestBelow(
      levels.sellSide,
      price
    );

  const sweeps =
    detectSweeps(
      candles,
      levels
    );

  return {
    buySide: levels.buySide,
    sellSide: levels.sellSide,

    equalHighs:
      levels.equalHighs,

    equalLows:
      levels.equalLows,

    nearestBuySide,
    nearestSellSide,

    recentSweeps:
      sweeps.slice(-10),

    latestSweep:
      sweeps.at(-1) || null
  };
}

module.exports = {
  getSwingLevels,
  findEqualLevels,
  getLiquidityLevels,
  nearestAbove,
  nearestBelow,
  detectSweeps,
  analyzeLiquidity
};
