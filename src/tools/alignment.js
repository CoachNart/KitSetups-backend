function normalizeTrend(trend) {
  if (trend === "bullish" || trend === "bearish") {
    return trend;
  }

  return "range";
}

function getStructure(structures, timeframe) {
  return normalizeTrend(
    structures?.[timeframe]?.trend
  );
}

function analyzeAlignment(structures = {}) {
  const timeframes = [
    "1w",
    "1d",
    "4h",
    "1h",
    "30m"
  ];

  const trends = Object.fromEntries(
    timeframes.map(tf => [
      tf,
      getStructure(structures, tf)
    ])
  );

  const weekly = trends["1w"];
  const daily = trends["1d"];
  const fourHour = trends["4h"];
  const oneHour = trends["1h"];
  const thirty = trends["30m"];

  const reversalWatch =
    (weekly === "bearish" &&
      daily === "bullish" &&
      fourHour !== "bullish") ||
    (weekly === "bullish" &&
      daily === "bearish" &&
      fourHour !== "bearish");

  const reversalDirection =
    daily === "bullish"
      ? "LONG"
      : daily === "bearish"
        ? "SHORT"
        : "NEUTRAL";

  let direction = "NEUTRAL";
  let longAllowed = false;
  let shortAllowed = false;

  /*
   * Normal directional market.
   *
   * 1D = primary bias
   * 4H = confirmation
   * 1H = trade context
   * 30M/15M = execution support
   */
  if (!reversalWatch) {
    const bullishConfirmation =
      thirty === "bullish" ? 1 : 0;

    const bearishConfirmation =
      thirty === "bearish" ? 1 : 0;

    longAllowed =
      daily === "bullish" &&
      fourHour === "bullish" &&
      oneHour === "bullish" &&
      bullishConfirmation >= 1;

    shortAllowed =
      daily === "bearish" &&
      fourHour === "bearish" &&
      oneHour === "bearish" &&
      bearishConfirmation >= 1;

    if (longAllowed && !shortAllowed) {
      direction = "LONG";
    } else if (shortAllowed && !longAllowed) {
      direction = "SHORT";
    }
  }

  /*
   * Reversal watch:
   *
   * 1W and 1D disagree.
   * Do NOT allow execution until 4H confirms
   * the new 1D direction.
   */
  if (reversalWatch) {
    direction = "REVERSAL_WATCH";
    longAllowed = false;
    shortAllowed = false;
  }

  const bullishCount = [
    daily,
    fourHour,
    oneHour
  ].filter(t => t === "bullish").length;

  const bearishCount = [
    daily,
    fourHour,
    oneHour
  ].filter(t => t === "bearish").length;

  const bullishConfirmation =
    thirty === "bullish" ? 1 : 0;

  const bearishConfirmation =
    thirty === "bearish" ? 1 : 0;

  const reasons = [];

  reasons.push(
    `1W: ${weekly.toUpperCase()}`
  );

  reasons.push(
    `1D: ${daily.toUpperCase()}`
  );

  reasons.push(
    `4H: ${fourHour.toUpperCase()}`
  );

  reasons.push(
    `1H: ${oneHour.toUpperCase()}`
  );

  reasons.push(
    `30M: ${thirty.toUpperCase()}`
  );

  if (reversalWatch) {
    reasons.push(
      `1D has reversed against 1W`
    );

    reasons.push(
      `4H has NOT confirmed the ${reversalDirection.toLowerCase()} reversal`
    );

    reasons.push(
      "Reversal watch only — execution blocked until 4H confirmation"
    );
  } else if (longAllowed) {
    reasons.push(
      "Higher-timeframe structure aligned bullish"
    );
  } else if (shortAllowed) {
    reasons.push(
      "Higher-timeframe structure aligned bearish"
    );
  } else {
    reasons.push(
      "No fully aligned directional setup"
    );
  }

  return {
    trends,

    weeklyContext: weekly,

    macro: {
      weekly,
      daily,
      bullishCount,
      bearishCount
    },

    primary: fourHour,
    setup: oneHour,

    confirmation: {
      "30m": thirty,
      bullishCount: bullishConfirmation,
      bearishCount: bearishConfirmation
    },

    execution: thirty,

    direction,

    longAllowed,
    shortAllowed,

    reversalWatch,

    bullishScore:
      (daily === "bullish" ? 1 : 0) +
      (fourHour === "bullish" ? 3 : 0) +
      (oneHour === "bullish" ? 2 : 0) +
      bullishConfirmation,

    bearishScore:
      (daily === "bearish" ? 1 : 0) +
      (fourHour === "bearish" ? 3 : 0) +
      (oneHour === "bearish" ? 2 : 0) +
      bearishConfirmation,

    reasons
  };
}

module.exports = {
  normalizeTrend,
  analyzeAlignment
};
