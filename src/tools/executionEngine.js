function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getClosed(candles = []) {
  return candles.filter(c => c?.isClosed !== false);
}

function range(c) {
  const high = finite(c?.high);
  const low = finite(c?.low);
  return high !== null && low !== null ? high - low : null;
}

function body(c) {
  const open = finite(c?.open);
  const close = finite(c?.close);
  return open !== null && close !== null ? Math.abs(close - open) : null;
}

function detectLiquiditySweep(candles = [], direction) {
  const data = getClosed(candles);

  if (data.length < 5) {
    return {
      detected: false,
      level: null,
      candle: null
    };
  }

  const last = data.at(-1);

  const lookback = data.slice(-6, -1);

  const highs = lookback
    .map(c => finite(c?.high))
    .filter(v => v !== null);

  const lows = lookback
    .map(c => finite(c?.low))
    .filter(v => v !== null);

  const high = finite(last?.high);
  const low = finite(last?.low);
  const close = finite(last?.close);

  if (
    high === null ||
    low === null ||
    close === null
  ) {
    return {
      detected: false,
      level: null,
      candle: null
    };
  }

  if (direction === "LONG") {
    const liquidity = Math.min(...lows);

    return {
      detected: low < liquidity && close > liquidity,
      type: "sell_side_sweep",
      level: liquidity,
      candle: last?.openTime || null
    };
  }

  if (direction === "SHORT") {
    const liquidity = Math.max(...highs);

    return {
      detected: high > liquidity && close < liquidity,
      type: "buy_side_sweep",
      level: liquidity,
      candle: last?.openTime || null
    };
  }

  return {
    detected: false,
    level: null,
    candle: null
  };
}

function detectDisplacement(candles = [], direction) {
  const data = getClosed(candles);

  if (data.length < 4) {
    return {
      detected: false,
      strength: 0,
      candle: null
    };
  }

  const last = data.at(-1);
  const previous = data.slice(-4, -1);

  const lastBody = body(last);
  const lastRange = range(last);

  if (
    lastBody === null ||
    lastRange === null ||
    lastRange <= 0
  ) {
    return {
      detected: false,
      strength: 0,
      candle: null
    };
  }

  const averageBody =
    previous
      .map(body)
      .filter(v => v !== null)
      .reduce((a, b) => a + b, 0) /
    Math.max(
      1,
      previous.filter(c => body(c) !== null).length
    );

  const ratio =
    averageBody > 0
      ? lastBody / averageBody
      : 0;

  const open = finite(last?.open);
  const close = finite(last?.close);

  const bullish =
    open !== null &&
    close !== null &&
    close > open;

  const bearish =
    open !== null &&
    close !== null &&
    close < open;

  const directional =
    direction === "LONG"
      ? bullish
      : direction === "SHORT"
        ? bearish
        : false;

  return {
    detected:
      directional &&
      ratio >= 1.5,

    strength: Number(ratio.toFixed(2)),
    candle: last?.openTime || null
  };
}

function detectExecutionBOS(
  structure,
  direction
) {
  if (!structure) {
    return false;
  }

  if (direction === "LONG") {
    return structure.bullishBOS === true;
  }

  if (direction === "SHORT") {
    return structure.bearishBOS === true;
  }

  return false;
}

function buildPOI(structure, direction) {
  if (!structure) return null;

  if (direction === "LONG") {
    return (
      structure.lastSwingLow?.price ??
      structure.bearishLevel ??
      null
    );
  }

  if (direction === "SHORT") {
    return (
      structure.lastSwingHigh?.price ??
      structure.bullishLevel ??
      null
    );
  }

  return null;
}

function buildRiskPlan(price, poi, direction, rr = 2) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(poi)
  ) {
    return {
      entry: null,
      stop: null,
      target: null,
      riskReward: null
    };
  }

  const risk = Math.abs(price - poi);

  if (risk <= 0) {
    return {
      entry: null,
      stop: null,
      target: null,
      riskReward: null
    };
  }

  if (direction === "LONG") {
    return {
      entry: price,
      stop: poi,
      target: price + risk * rr,
      riskReward: rr
    };
  }

  if (direction === "SHORT") {
    return {
      entry: price,
      stop: poi,
      target: price - risk * rr,
      riskReward: rr
    };
  }

  return {
    entry: null,
    stop: null,
    target: null,
    riskReward: null
  };
}

function executionGate({
  direction,
  htfConfirmed = false,
  setupStructure = null,
  executionCandles = [],
  price = null
}) {
  const result = {
    direction: direction || "WAIT",
    status: "WAIT",
    executable: false,
    liquidity: null,
    displacement: null,
    bos: false,
    poi: null,
    entry: null,
    stop: null,
    target: null,
    riskReward: null,
    reasons: []
  };

  if (!direction || direction === "WAIT") {
    result.reasons.push("No directional setup");
    return result;
  }

  if (!htfConfirmed) {
    result.reasons.push("HTF confirmation incomplete");
    return result;
  }

  result.liquidity =
    detectLiquiditySweep(
      executionCandles,
      direction
    );

  result.displacement =
    detectDisplacement(
      executionCandles,
      direction
    );

  result.bos =
    detectExecutionBOS(
      setupStructure,
      direction
    );

  if (!result.liquidity.detected) {
    result.reasons.push("Liquidity sweep not confirmed");
  }

  if (!result.displacement.detected) {
    result.reasons.push("Displacement not confirmed");
  }

  if (!result.bos) {
    result.reasons.push("Execution BOS not confirmed");
  }

  if (
    !result.liquidity.detected ||
    !result.displacement.detected ||
    !result.bos
  ) {
    return result;
  }

  result.poi =
    buildPOI(
      setupStructure,
      direction
    );

  const riskPlan =
    buildRiskPlan(
      price,
      result.poi,
      direction
    );

  Object.assign(
    result,
    riskPlan
  );

  if (
    result.entry === null ||
    result.stop === null ||
    result.target === null
  ) {
    result.reasons.push("Risk plan invalid");
    return result;
  }

  result.status = "READY";
  result.executable = true;
  result.reasons.push(
    "Execution conditions confirmed"
  );

  return result;
}

module.exports = {
  detectLiquiditySweep,
  detectDisplacement,
  detectExecutionBOS,
  buildPOI,
  buildRiskPlan,
  executionGate
};
