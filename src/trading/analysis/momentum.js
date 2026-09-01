"use strict";

/*
 * ============================================================
 * KITSETUPS — MOMENTUM ANALYSIS
 * ============================================================
 *
 * Purpose:
 *   Measure directional momentum from CLOSED candles only.
 *
 * Rules:
 *   - No trade decisions.
 *   - No entry generation.
 *   - No stop/target logic.
 *   - No lifecycle logic.
 *   - 30m is the minimum trading timeframe.
 *   - 1h is included as the execution confirmation timeframe.
 *
 * Output describes momentum; it does not manufacture a setup.
 * ============================================================
 */

const TIMEFRAMES = ["1w", "1d", "4h", "1h", "30m"];

const MIN_CANDLES = 30;

function finite(value) {
  return Number.isFinite(Number(value));
}

function number(value) {
  return Number(value);
}

function closedCandles(candles = []) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles.filter(
    (candle) =>
      candle &&
      candle.isClosed !== false &&
      finite(candle.open) &&
      finite(candle.high) &&
      finite(candle.low) &&
      finite(candle.close)
  );
}

function body(candle) {
  return Math.abs(number(candle.close) - number(candle.open));
}

function range(candle) {
  return number(candle.high) - number(candle.low);
}

function bullish(candle) {
  return number(candle.close) > number(candle.open);
}

function bearish(candle) {
  return number(candle.close) < number(candle.open);
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

/*
 * ------------------------------------------------------------
 * Rate of change
 * ------------------------------------------------------------
 *
 * Measures directional price expansion over recent candles.
 */
function calculateROC(candles, lookback = 10) {
  if (candles.length <= lookback) {
    return 0;
  }

  const current = number(candles.at(-1).close);
  const previous = number(
    candles[candles.length - 1 - lookback].close
  );

  if (!previous) {
    return 0;
  }

  return ((current - previous) / previous) * 100;
}

/*
 * ------------------------------------------------------------
 * Candle pressure
 * ------------------------------------------------------------
 *
 * Compares bullish vs bearish bodies over recent candles.
 */
function calculatePressure(candles, lookback = 8) {
  const recent = candles.slice(-lookback);

  let bullishBody = 0;
  let bearishBody = 0;

  for (const candle of recent) {
    const candleBody = body(candle);

    if (bullish(candle)) {
      bullishBody += candleBody;
    } else if (bearish(candle)) {
      bearishBody += candleBody;
    }
  }

  const total = bullishBody + bearishBody;

  if (!total) {
    return 0;
  }

  return ((bullishBody - bearishBody) / total) * 100;
}

/*
 * ------------------------------------------------------------
 * Expansion
 * ------------------------------------------------------------
 *
 * Detects whether recent candles are expanding relative to
 * their normal recent range.
 */
function calculateExpansion(candles, lookback = 5) {
  if (candles.length < lookback + 10) {
    return {
      currentAverageRange: 0,
      baselineAverageRange: 0,
      ratio: 1,
      expanding: false,
    };
  }

  const recent = candles.slice(-lookback);
  const baseline = candles.slice(
    -(lookback + 10),
    -lookback
  );

  const currentAverageRange = average(
    recent.map(range).filter((value) => value > 0)
  );

  const baselineAverageRange = average(
    baseline.map(range).filter((value) => value > 0)
  );

  const ratio =
    baselineAverageRange > 0
      ? currentAverageRange / baselineAverageRange
      : 1;

  return {
    currentAverageRange,
    baselineAverageRange,
    ratio,
    expanding: ratio >= 1.25,
  };
}

/*
 * ------------------------------------------------------------
 * Momentum direction
 * ------------------------------------------------------------
 */
function determineDirection(roc, pressure) {
  if (roc > 0 && pressure > 10) {
    return "bullish";
  }

  if (roc < 0 && pressure < -10) {
    return "bearish";
  }

  return "neutral";
}

/*
 * ------------------------------------------------------------
 * Momentum strength
 * ------------------------------------------------------------
 *
 * This is descriptive only.
 */
function calculateStrength({
  roc,
  pressure,
  expansion,
}) {
  let score = 0;

  /*
   * Price movement.
   */
  if (Math.abs(roc) >= 1.5) {
    score += 35;
  } else if (Math.abs(roc) >= 0.75) {
    score += 25;
  } else if (Math.abs(roc) >= 0.25) {
    score += 15;
  }

  /*
   * Candle pressure.
   */
  if (Math.abs(pressure) >= 60) {
    score += 35;
  } else if (Math.abs(pressure) >= 35) {
    score += 25;
  } else if (Math.abs(pressure) >= 15) {
    score += 15;
  }

  /*
   * Expansion.
   */
  if (expansion.ratio >= 1.5) {
    score += 30;
  } else if (expansion.ratio >= 1.25) {
    score += 20;
  } else if (expansion.ratio >= 1.1) {
    score += 10;
  }

  return Math.min(100, score);
}

/*
 * ------------------------------------------------------------
 * Analyze one timeframe
 * ------------------------------------------------------------
 */
function analyzeTimeframe(candles = []) {
  const closed = closedCandles(candles);

  if (closed.length < MIN_CANDLES) {
    return {
      direction: "neutral",
      strength: 0,
      roc: 0,
      pressure: 0,
      expansion: {
        currentAverageRange: 0,
        baselineAverageRange: 0,
        ratio: 1,
        expanding: false,
      },
      sufficientData: false,
    };
  }

  const roc = calculateROC(closed);
  const pressure = calculatePressure(closed);
  const expansion = calculateExpansion(closed);

  const direction = determineDirection(
    roc,
    pressure
  );

  const strength = calculateStrength({
    roc,
    pressure,
    expansion,
  });

  return {
    direction,
    strength,
    roc: Number(roc.toFixed(4)),
    pressure: Number(pressure.toFixed(2)),
    expansion: {
      currentAverageRange: Number(
        expansion.currentAverageRange.toFixed(8)
      ),
      baselineAverageRange: Number(
        expansion.baselineAverageRange.toFixed(8)
      ),
      ratio: Number(expansion.ratio.toFixed(3)),
      expanding: expansion.expanding,
    },
    sufficientData: true,
  };
}

/*
 * ------------------------------------------------------------
 * Cross-timeframe momentum
 * ------------------------------------------------------------
 *
 * Higher timeframes provide context.
 * 1h and 30m are the execution-side momentum readings.
 *
 * Nothing here creates a signal.
 * ------------------------------------------------------------
 */
function analyzeMomentum(timeframes = {}) {
  const result = {};

  for (const timeframe of TIMEFRAMES) {
    const data = timeframes[timeframe];

    const candles =
      Array.isArray(data)
        ? data
        : data?.candles || [];

    result[timeframe] = analyzeTimeframe(candles);
  }

  const available = TIMEFRAMES.filter(
    (timeframe) =>
      result[timeframe]?.sufficientData
  );

  const directionalVotes = {
    bullish: 0,
    bearish: 0,
    neutral: 0,
  };

  for (const timeframe of available) {
    const direction =
      result[timeframe].direction;

    directionalVotes[direction] += 1;
  }

  let overall = "neutral";

  if (
    directionalVotes.bullish >
      directionalVotes.bearish
  ) {
    overall = "bullish";
  } else if (
    directionalVotes.bearish >
      directionalVotes.bullish
  ) {
    overall = "bearish";
  }

  return {
    overall,

    timeframes: result,

    execution: {
      "1h": result["1h"],
      "30m": result["30m"],
    },

    votes: directionalVotes,

    sufficientData:
      available.length === TIMEFRAMES.length,
  };
}

module.exports = {
  analyzeMomentum,
  analyzeTimeframe,
};
