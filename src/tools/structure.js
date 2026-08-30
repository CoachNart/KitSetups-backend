function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/*
 * =========================================================
 * SWING DETECTION
 * =========================================================
 *
 * Candles are expected in chronological order:
 * oldest -> newest
 *
 * A swing is confirmed only when candles exist on both
 * sides of the candidate candle.
 */

function findSwingHighs(candles = [], strength = 2) {
  const swings = [];

  if (!Array.isArray(candles)) {
    return swings;
  }

  const safeStrength = Math.max(
    1,
    Math.floor(Number(strength) || 2)
  );

  for (
    let i = safeStrength;
    i < candles.length - safeStrength;
    i++
  ) {
    const current = finite(candles[i]?.high);

    if (current === null) {
      continue;
    }

    let valid = true;

    for (
      let j = 1;
      j <= safeStrength;
      j++
    ) {
      const left = finite(
        candles[i - j]?.high
      );

      const right = finite(
        candles[i + j]?.high
      );

      if (
        left === null ||
        right === null ||
        current <= left ||
        current <= right
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

function findSwingLows(candles = [], strength = 2) {
  const swings = [];

  if (!Array.isArray(candles)) {
    return swings;
  }

  const safeStrength = Math.max(
    1,
    Math.floor(Number(strength) || 2)
  );

  for (
    let i = safeStrength;
    i < candles.length - safeStrength;
    i++
  ) {
    const current = finite(candles[i]?.low);

    if (current === null) {
      continue;
    }

    let valid = true;

    for (
      let j = 1;
      j <= safeStrength;
      j++
    ) {
      const left = finite(
        candles[i - j]?.low
      );

      const right = finite(
        candles[i + j]?.low
      );

      if (
        left === null ||
        right === null ||
        current >= left ||
        current >= right
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

/*
 * =========================================================
 * STRUCTURE CLASSIFICATION
 * =========================================================
 */

function classifyStructure(
  highs = [],
  lows = [],
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

  /*
   * Structural pattern has priority.
   *
   * BOS is treated as an event and should not
   * automatically overwrite an established structural
   * pattern.
   */
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
    breaks.bullishCHoCH
  ) {
    trend = "bullish";
  } else if (
    breaks.bearishCHoCH
  ) {
    trend = "bearish";
  }

  return {
    trend,
    highPattern,
    lowPattern
  };
}

/*
 * =========================================================
 * BREAK / BOS / CHoCH DETECTION
 * =========================================================
 *
 * IMPORTANT:
 *
 * A level must exist BEFORE the break.
 *
 * We therefore:
 *
 * 1. Find the latest confirmed swing.
 * 2. Require the break candle to occur after that swing.
 * 3. Require the latest closed candle to actually close
 *    beyond the level.
 *
 * This prevents a swing from being "broken" by the same
 * candle that created it.
 */

function findLatestPriorSwing(
  swings = [],
  candleIndex
) {
  for (
    let i = swings.length - 1;
    i >= 0;
    i--
  ) {
    const swing = swings[i];

    if (
      Number.isInteger(swing?.index) &&
      swing.index < candleIndex
    ) {
      return swing;
    }
  }

  return null;
}

function findPriorStructureBias(
  highs = [],
  lows = []
) {
  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return "neutral";
  }

  const lastHigh = highs.at(-1);
  const previousHigh = highs.at(-2);

  const lastLow = lows.at(-1);
  const previousLow = lows.at(-2);

  const higherHigh =
    lastHigh.price > previousHigh.price;

  const higherLow =
    lastLow.price > previousLow.price;

  const lowerHigh =
    lastHigh.price < previousHigh.price;

  const lowerLow =
    lastLow.price < previousLow.price;

  if (
    higherHigh &&
    higherLow
  ) {
    return "bullish";
  }

  if (
    lowerHigh &&
    lowerLow
  ) {
    return "bearish";
  }

  return "neutral";
}

function detectBreaks(
  candles = [],
  highs = [],
  lows = []
) {
  const closed =
    candles.filter(
      candle =>
        candle &&
        candle.isClosed !== false
    );

  if (closed.length < 3) {
    return {
      bullishBOS: false,
      bearishBOS: false,

      bullishCHoCH: false,
      bearishCHoCH: false,

      bullishLevel: null,
      bearishLevel: null,

      bullishBreakCandle: null,
      bearishBreakCandle: null,

      bullishBreakIndex: null,
      bearishBreakIndex: null
    };
  }

  /*
   * Latest closed candle is the only candle that can
   * trigger the CURRENT structure event.
   */
  const latestIndex =
    closed.length - 1;

  const latest =
    closed[latestIndex];

  const close =
    finite(latest?.close);

  if (close === null) {
    return {
      bullishBOS: false,
      bearishBOS: false,

      bullishCHoCH: false,
      bearishCHoCH: false,

      bullishLevel: null,
      bearishLevel: null,

      bullishBreakCandle: null,
      bearishBreakCandle: null,

      bullishBreakIndex: null,
      bearishBreakIndex: null
    };
  }

  const priorHigh =
    findLatestPriorSwing(
      highs,
      latestIndex
    );

  const priorLow =
    findLatestPriorSwing(
      lows,
      latestIndex
    );

  const bullishLevel =
    priorHigh?.price ?? null;

  const bearishLevel =
    priorLow?.price ?? null;

  const bullishBreak =
    bullishLevel !== null &&
    close > bullishLevel;

  const bearishBreak =
    bearishLevel !== null &&
    close < bearishLevel;

  /*
   * Determine the structure that existed BEFORE
   * the current break.
   */
  const priorBias =
    findPriorStructureBias(
      highs,
      lows
    );

  /*
   * BOS:
   *
   * Break in the same direction as the existing
   * structure.
   *
   * CHoCH:
   *
   * Break against the existing structure.
   */
  const bullishBOS =
    bullishBreak &&
    priorBias !== "bearish";

  const bearishBOS =
    bearishBreak &&
    priorBias !== "bullish";

  const bullishCHoCH =
    bullishBreak &&
    priorBias === "bearish";

  const bearishCHoCH =
    bearishBreak &&
    priorBias === "bullish";

  return {
    bullishBOS,
    bearishBOS,

    bullishCHoCH,
    bearishCHoCH,

    bullishLevel,
    bearishLevel,

    bullishBreakCandle:
      bullishBreak
        ? latest.openTime
        : null,

    bearishBreakCandle:
      bearishBreak
        ? latest.openTime
        : null,

    bullishBreakIndex:
      bullishBreak
        ? latestIndex
        : null,

    bearishBreakIndex:
      bearishBreak
        ? latestIndex
        : null
  };
}

/*
 * =========================================================
 * MAIN STRUCTURE ANALYSIS
 * =========================================================
 */

function analyzeStructure(
  candles = [],
  strength = 2
) {
  if (!Array.isArray(candles)) {
    return {
      trend: "insufficient_data",
      highPattern: null,
      lowPattern: null,

      lastSwingHigh: null,
      previousSwingHigh: null,

      lastSwingLow: null,
      previousSwingLow: null,

      swingHighs: [],
      swingLows: [],

      bullishBOS: false,
      bearishBOS: false,

      bullishCHoCH: false,
      bearishCHoCH: false,

      bullishLevel: null,
      bearishLevel: null,

      bullishBreakCandle: null,
      bearishBreakCandle: null,

      bullishBreakIndex: null,
      bearishBreakIndex: null
    };
  }

  const closed =
    candles.filter(
      candle =>
        candle &&
        candle.isClosed !== false
    );

  /*
   * Minimum candles required for meaningful structure.
   *
   * We need enough candles to:
   * - confirm swings on both sides
   * - obtain at least two structural observations
   *
   * This scales with swing strength instead of relying
   * on an arbitrary hard-coded minimum.
   */
  const safeStrength = Math.max(
    1,
    Math.floor(Number(strength) || 2)
  );

  const minimumCandles =
    Math.max(
      2 * safeStrength + 3,
      7
    );

  if (closed.length < minimumCandles) {
    return {
      trend: "insufficient_data",
      highPattern: null,
      lowPattern: null,

      lastSwingHigh: null,
      previousSwingHigh: null,

      lastSwingLow: null,
      previousSwingLow: null,

      swingHighs: [],
      swingLows: [],

      bullishBOS: false,
      bearishBOS: false,

      bullishCHoCH: false,
      bearishCHoCH: false,

      bullishLevel: null,
      bearishLevel: null,

      bullishBreakCandle: null,
      bearishBreakCandle: null,

      bullishBreakIndex: null,
      bearishBreakIndex: null
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
