function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findSwingHighs(candles, strength = 2) {
  const swings = [];

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current = finite(candles[i]?.high);

    if (current === null) continue;

    let valid = true;

    for (let j = 1; j <= strength; j++) {
      if (
        current <= finite(candles[i - j]?.high) ||
        current <= finite(candles[i + j]?.high)
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      swings.push({
        index: i,
        price: current,
        time: candles[i].openTime
      });
    }
  }

  return swings;
}

function findSwingLows(candles, strength = 2) {
  const swings = [];

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current = finite(candles[i]?.low);

    if (current === null) continue;

    let valid = true;

    for (let j = 1; j <= strength; j++) {
      if (
        current >= finite(candles[i - j]?.low) ||
        current >= finite(candles[i + j]?.low)
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      swings.push({
        index: i,
        price: current,
        time: candles[i].openTime
      });
    }
  }

  return swings;
}

function classifyStructure(
  highs,
  lows,
  breaks = {}
) {
  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return {
      trend: "insufficient_data",
      highPattern: null,
      lowPattern: null
    };
  }

  const lastHigh = highs.at(-1);
  const previousHigh = highs.at(-2);

  const lastLow = lows.at(-1);
  const previousLow = lows.at(-2);

  const highPattern =
    lastHigh.price > previousHigh.price
      ? "HH"
      : lastHigh.price < previousHigh.price
        ? "LH"
        : "EQH";

  const lowPattern =
    lastLow.price > previousLow.price
      ? "HL"
      : lastLow.price < previousLow.price
        ? "LL"
        : "EQL";

  let trend = "range";

  if (
    highPattern === "HH" &&
    lowPattern === "HL"
  ) {
    trend = "bullish";
  } else if (
    highPattern === "LH" &&
    lowPattern === "LL"
  ) {
    trend = "bearish";
  } else if (
    breaks.bullishBOS
  ) {
    trend = "bullish";
  } else if (
    breaks.bearishBOS
  ) {
    trend = "bearish";
  }

  return {
    trend,
    highPattern,
    lowPattern
  };
}

function detectBreaks(
  candles,
  highs,
  lows
) {
  const closed =
    candles.filter(c => c.isClosed !== false);

  const lastClose =
    finite(closed.at(-1)?.close);

  if (lastClose === null) {
    return {
      bullishBOS: false,
      bearishBOS: false,
      bullishLevel: null,
      bearishLevel: null
    };
  }

  const previousHigh =
    highs.at(-1)?.price ?? null;

  const previousLow =
    lows.at(-1)?.price ?? null;

  return {
    bullishBOS:
      previousHigh !== null &&
      lastClose > previousHigh,

    bearishBOS:
      previousLow !== null &&
      lastClose < previousLow,

    bullishLevel: previousHigh,
    bearishLevel: previousLow
  };
}

function analyzeStructure(
  candles,
  strength = 2
) {
  const closed =
    candles.filter(c => c.isClosed !== false);

  if (closed.length < 10) {
    return {
      trend: "insufficient_data",
      highPattern: null,
      lowPattern: null,
      swingHighs: [],
      swingLows: [],
      bullishBOS: false,
      bearishBOS: false
    };
  }

  const highs =
    findSwingHighs(
      closed,
      strength
    );

  const lows =
    findSwingLows(
      closed,
      strength
    );

    const breaks =
      detectBreaks(
        closed,
        highs,
        lows
      );

    const classification =
      classifyStructure(
        highs,
        lows,
        breaks
      );

  return {
    ...classification,

    lastSwingHigh:
      highs.at(-1) || null,

    previousSwingHigh:
      highs.at(-2) || null,

    lastSwingLow:
      lows.at(-1) || null,

    previousSwingLow:
      lows.at(-2) || null,

    swingHighs:
      highs.slice(-10),

    swingLows:
      lows.slice(-10),

    ...breaks
  };
}

module.exports = {
  findSwingHighs,
  findSwingLows,
  classifyStructure,
  detectBreaks,
  analyzeStructure
};
