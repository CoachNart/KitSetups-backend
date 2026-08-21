function normalizeTrend(trend) {
  if (
    trend === "bullish" ||
    trend === "bearish"
  ) {
    return trend;
  }

  return "range";
}

function getStructure(
  structures,
  timeframe
) {
  return normalizeTrend(
    structures?.[timeframe]?.trend
  );
}

function count(
  values,
  target
) {
  return values.filter(
    value => value === target
  ).length;
}

function analyzeAlignment(structures = {}) {
  const timeframes = [
    "1d",
    "4h",
    "1h",
    "30m",
    "15m"
  ];

  const trends = Object.fromEntries(
    timeframes.map(tf => [
      tf,
      getStructure(structures, tf)
    ])
  );

  const macro = trends["1d"];
  const primary = trends["4h"];
  const setup = trends["1h"];

  const bullishConfirmation =
    [trends["30m"], trends["15m"]]
      .filter(t => t === "bullish")
      .length;

  const bearishConfirmation =
    [trends["30m"], trends["15m"]]
      .filter(t => t === "bearish")
      .length;

  const longAllowed =
    macro === "bullish" &&
    primary === "bullish" &&
    setup === "bullish" &&
    bullishConfirmation >= 1;

  const shortAllowed =
    macro === "bearish" &&
    primary === "bearish" &&
    setup === "bearish" &&
    bearishConfirmation >= 1;

  let direction = "NEUTRAL";

  if (longAllowed && !shortAllowed) {
    direction = "LONG";
  } else if (shortAllowed && !longAllowed) {
    direction = "SHORT";
  }

  const bullishCount = [
    macro,
    primary,
    setup
  ].filter(t => t === "bullish").length;

  const bearishCount = [
    macro,
    primary,
    setup
  ].filter(t => t === "bearish").length;

  const reasons = [];

  if (macro === "bullish") {
    reasons.push("1D structure is bullish");
  }

  if (primary === "bullish") {
    reasons.push("4H structure is bullish");
  }

  if (setup === "bullish") {
    reasons.push("1H structure is bullish");
  }

  if (
    trends["30m"] === "bullish" ||
    trends["15m"] === "bullish"
  ) {
    reasons.push("Lower timeframe structure supports longs");
  }

  if (
    trends["30m"] === "range" &&
    trends["15m"] === "range"
  ) {
    reasons.push("30M and 15M are ranging");
  }

  if (
    trends["30m"] === "bearish" &&
    macro === "bullish"
  ) {
    reasons.push("30M is bearish against bullish higher-timeframe structure");
  }

  if (
    trends["15m"] === "bearish" &&
    primary === "bullish"
  ) {
    reasons.push("15M is bearish against bullish higher-timeframe structure");
  }

  if (
    trends["30m"] === "bullish" &&
    macro === "bearish"
  ) {
    reasons.push("30M is bullish against bearish higher-timeframe structure");
  }

  if (
    trends["15m"] === "bullish" &&
    primary === "bearish"
  ) {
    reasons.push("15M is bullish against bearish higher-timeframe structure");
  }

  if (!longAllowed && !shortAllowed) {
    reasons.push("No fully aligned directional setup");
  }

  const bullishScore =
    (macro === "bullish" ? 1 : 0) +
    (primary === "bullish" ? 3 : 0) +
    (setup === "bullish" ? 2 : 0) +
    bullishConfirmation;

  const bearishScore =
    (macro === "bearish" ? 1 : 0) +
    (primary === "bearish" ? 3 : 0) +
    (setup === "bearish" ? 2 : 0) +
    bearishConfirmation;

  return {
    trends,

    macro: {
      daily: macro,
      bullishCount,
      bearishCount
    },

    primary,
    setup,

    confirmation: {
      "30m": trends["30m"],
      "15m": trends["15m"],
      bullishCount: bullishConfirmation,
      bearishCount: bearishConfirmation
    },

    execution: trends["15m"],

    direction,
    longAllowed,
    shortAllowed,

    bullishScore,
    bearishScore,

    reasons
  };
}

module.exports = {
  normalizeTrend,
  analyzeAlignment
};
