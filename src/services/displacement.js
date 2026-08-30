function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function body(c) {
  return Math.abs(Number(c.close) - Number(c.open));
}

function range(c) {
  return Number(c.high) - Number(c.low);
}

function bodyRatio(c) {
  const r = range(c);
  return r > 0 ? body(c) / r : 0;
}

function direction(c) {
  if (Number(c.close) > Number(c.open)) return "BULLISH";
  if (Number(c.close) < Number(c.open)) return "BEARISH";
  return "NEUTRAL";
}

function evaluateCandle(candles, index, options = {}) {
  const lookback = options.lookback || 20;
  const minimumBodyRatio =
    options.minimumBodyRatio || 0.65;

  if (index < lookback) return null;

  const candle = candles[index];

  const history = candles.slice(
    index - lookback,
    index
  );

  const bodies = history
    .map(body)
    .filter(v => Number.isFinite(v) && v > 0);

  const ranges = history
    .map(range)
    .filter(v => Number.isFinite(v) && v > 0);

  if (!bodies.length || !ranges.length) {
    return null;
  }

  const averageBody = average(bodies);
  const averageRange = average(ranges);

  const currentBody = body(candle);
  const currentRange = range(candle);
  const currentRatio = bodyRatio(candle);

  if (
    currentRange <= 0 ||
    averageBody <= 0 ||
    averageRange <= 0
  ) {
    return null;
  }

  const bodyExpansion =
    currentBody / averageBody;

  const rangeExpansion =
    currentRange / averageRange;

  const dir = direction(candle);

  const valid =
    dir !== "NEUTRAL" &&
    bodyExpansion >= 1.5 &&
    currentRatio >= minimumBodyRatio &&
    rangeExpansion >= 1.15;

  if (!valid) return null;

  const score = Math.round(
    Math.min(bodyExpansion / 2, 1) * 50 +
    Math.min(
      currentRatio / minimumBodyRatio,
      1
    ) * 30 +
    Math.min(rangeExpansion / 1.5, 1) * 20
  );

  return {
    type: "DISPLACEMENT",
    direction: dir,
    timestamp: candle.timestamp,
    candleIndex: index,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    body: currentBody,
    range: currentRange,
    bodyExpansion: Number(
      bodyExpansion.toFixed(2)
    ),
    rangeExpansion: Number(
      rangeExpansion.toFixed(2)
    ),
    bodyRatio: Number(
      currentRatio.toFixed(2)
    ),
    score,
    confirmation: "STRONG_CANDLE",
  };
}

function detectDisplacement(
  candles,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 25
  ) {
    return null;
  }

  return evaluateCandle(
    candles,
    candles.length - 1,
    options
  );
}

function detectRecentDisplacement(
  candles,
  lookbackCandles = 3,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 25
  ) {
    return null;
  }

  const start = Math.max(
    20,
    candles.length - lookbackCandles
  );

  const candidates = [];

  for (
    let i = start;
    i < candles.length;
    i++
  ) {
    const result =
      evaluateCandle(
        candles,
        i,
        options
      );

    if (result) {
      candidates.push(result);
    }
  }

  return (
    candidates.sort(
      (a, b) =>
        b.score - a.score
    )[0] || null
  );
}

/*
 * Contextual displacement
 *
 * A sweep must happen BEFORE the displacement.
 *
 * Bearish BSL sweep -> bearish displacement
 * Bullish SSL sweep -> bullish displacement
 *
 * The displacement must occur within the
 * configured number of candles after the sweep.
 */
function detectContextualDisplacement(
  candles,
  sweep,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    !sweep
  ) {
    return null;
  }

  const maxCandlesAfterSweep =
    options.maxCandlesAfterSweep || 3;

  const sweepIndex =
    Number.isInteger(sweep.candleIndex)
      ? sweep.candleIndex
      : candles.findIndex(
          c =>
            c.timestamp ===
            sweep.timestamp
        );

  if (sweepIndex < 0) {
    return null;
  }

  const expectedDirection =
    sweep.direction === "BEARISH"
      ? "BEARISH"
      : sweep.direction === "BULLISH"
        ? "BULLISH"
        : null;

  if (!expectedDirection) {
    return null;
  }

  const end = Math.min(
    candles.length - 1,
    sweepIndex +
      maxCandlesAfterSweep
  );

  const candidates = [];

  for (
    let i = sweepIndex + 1;
    i <= end;
    i++
  ) {
    const displacement =
      evaluateCandle(
        candles,
        i,
        options
      );

    if (
      displacement &&
      displacement.direction ===
        expectedDirection
    ) {
      candidates.push({
        ...displacement,
        type:
          "CONTEXTUAL_DISPLACEMENT",
        sweepType: sweep.type,
        sweepDirection:
          sweep.direction,
        sweepLevel: sweep.level,
        sweepTimestamp:
          sweep.timestamp,
        sweepCandleIndex:
          sweepIndex,
        confirmation:
          "SWEEP_THEN_DISPLACEMENT",
      });
    }
  }

  return (
    candidates.sort(
      (a, b) =>
        b.score - a.score
    )[0] || null
  );
}

module.exports = {
  detectDisplacement,
  detectRecentDisplacement,
  detectContextualDisplacement,
};
