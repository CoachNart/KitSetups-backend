function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function body(candle) {
  return Math.abs(
    finite(candle?.close) - finite(candle?.open)
  );
}

function range(candle) {
  return (
    finite(candle?.high) -
    finite(candle?.low)
  );
}

function upperWick(candle) {
  return (
    finite(candle?.high) -
    Math.max(
      finite(candle?.open),
      finite(candle?.close)
    )
  );
}

function lowerWick(candle) {
  return (
    Math.min(
      finite(candle?.open),
      finite(candle?.close)
    ) -
    finite(candle?.low)
  );
}

function direction(candle) {
  if (
    finite(candle?.open) === null ||
    finite(candle?.close) === null
  ) {
    return "neutral";
  }

  if (candle.close > candle.open) {
    return "bullish";
  }

  if (candle.close < candle.open) {
    return "bearish";
  }

  return "neutral";
}

function analyzeCandle(candle) {
  const candleRange = range(candle);
  const candleBody = body(candle);

  if (
    candleRange === null ||
    candleBody === null ||
    candleRange <= 0
  ) {
    return {
      valid: false
    };
  }

  const bodyRatio =
    candleBody / candleRange;

  const upper =
    upperWick(candle);

  const lower =
    lowerWick(candle);

  return {
    valid: true,
    direction: direction(candle),
    range: candleRange,
    body: candleBody,
    bodyRatio: Number(
      bodyRatio.toFixed(3)
    ),
    upperWick: upper,
    lowerWick: lower,
    bullishClose:
      candle.close >
      candle.low +
      candleRange * 0.65,
    bearishClose:
      candle.close <
      candle.low +
      candleRange * 0.35
  };
}

/*
 * Candle Range Theory
 *
 * We treat the latest closed candle as the
 * current range and compare subsequent price
 * behavior against its high/low.
 *
 * The range itself becomes a decision framework:
 *
 * LONG:
 * - bullish expansion above range high
 * - bullish reclaim after taking range low
 *
 * SHORT:
 * - bearish expansion below range low
 * - bearish rejection after taking range high
 */

function analyzeCRT(
  candles = [],
  directionWanted = null
) {
  const closed =
    candles.filter(
      candle => candle?.isClosed !== false
    );

  if (closed.length < 3) {
    return {
      valid: false,
      status: "INSUFFICIENT_DATA"
    };
  }

  const rangeCandle =
    closed.at(-2);

  const latest =
    closed.at(-1);

  const high =
    finite(rangeCandle.high);

  const low =
    finite(rangeCandle.low);

  if (
    high === null ||
    low === null ||
    high <= low
  ) {
    return {
      valid: false,
      status: "INVALID_RANGE"
    };
  }

  const latestHigh =
    finite(latest.high);

  const latestLow =
    finite(latest.low);

  const latestClose =
    finite(latest.close);

  const tookHigh =
    latestHigh > high;

  const tookLow =
    latestLow < low;

  const reclaimedHigh =
    latestClose > high;

  const reclaimedLow =
    latestClose < low;

  const bullishExpansion =
    tookHigh &&
    reclaimedHigh;

  const bearishExpansion =
    tookLow &&
    reclaimedLow;

  const bullishSweep =
    tookLow &&
    latestClose > low;

  const bearishSweep =
    tookHigh &&
    latestClose < high;

  let signal = "NONE";

  if (
    bullishExpansion
  ) {
    signal = "BULLISH_EXPANSION";
  } else if (
    bearishExpansion
  ) {
    signal = "BEARISH_EXPANSION";
  } else if (
    bullishSweep
  ) {
    signal = "BULLISH_RECLAIM";
  } else if (
    bearishSweep
  ) {
    signal = "BEARISH_RECLAIM";
  }

  if (
    directionWanted === "LONG" &&
    !signal.startsWith("BULLISH")
  ) {
    signal = "NONE";
  }

  if (
    directionWanted === "SHORT" &&
    !signal.startsWith("BEARISH")
  ) {
    signal = "NONE";
  }

  return {
    valid: true,

    status:
      signal === "NONE"
        ? "WAIT"
        : "CONFIRMED",

    signal,

    range: {
      high,
      low,
      midpoint:
        Number(
          ((high + low) / 2).toFixed(2)
        )
    },

    candle: {
      openTime:
        rangeCandle.openTime,
      high,
      low
    },

    latest: {
      openTime:
        latest.openTime,
      high: latestHigh,
      low: latestLow,
      close: latestClose
    },

    events: {
      tookHigh,
      tookLow,
      reclaimedHigh,
      reclaimedLow,
      bullishExpansion,
      bearishExpansion,
      bullishSweep,
      bearishSweep
    }
  };
}

module.exports = {
  analyzeCandle,
  analyzeCRT
};
