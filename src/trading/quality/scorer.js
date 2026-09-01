"use strict";

/*
 * ============================================================
 * KITSETUPS — SETUP QUALITY SCORER
 * ============================================================
 *
 * Responsibility:
 *
 * Evaluate the quality of an already-detected setup.
 *
 * This module does NOT:
 * - detect a setup
 * - choose direction
 * - calculate entry
 * - calculate stop
 * - calculate targets
 * - create market structure
 * - override another engine
 *
 * It only scores evidence.
 *
 * Maximum score: 100
 *
 * Components:
 *
 *   Higher-timeframe alignment     25
 *   Structural confirmation        20
 *   Liquidity confirmation         15
 *   Momentum confirmation          15
 *   Execution confirmation        15
 *   Risk/reward quality            10
 *
 * Minimum publish quality:
 *
 *   Score >= 70
 *   RR >= 2R
 *
 * Grade:
 *
 *   A+ = 90–100
 *   A  = 80–89
 *   B  = 70–79
 *   C  = 60–69
 *   D  = below 60
 *
 * The scorer deliberately does NOT make
 * a trade valid by itself.
 */

const MIN_RR = 2.0;
const MIN_SCORE = 70;

const MAX_SCORE = 100;

function finite(value) {
  return Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function directionMatches(
  direction,
  value
) {
  if (!direction || !value) {
    return false;
  }

  return String(value).toUpperCase() ===
    String(direction).toUpperCase();
}

function getDirectionalEvidence(
  direction,
  context
) {
  if (!context || !direction) {
    return 0;
  }

  const expected =
    direction === "LONG"
      ? "bullish"
      : "bearish";

  let score = 0;

  const macro =
    context.timeframes?.["1w"];

  const primary =
    context.timeframes?.["1d"];

  const intermediate =
    context.timeframes?.["4h"];

  if (
    macro?.trend === expected ||
    macro?.structure === expected
  ) {
    score += 13;
  }

  if (
    primary?.trend === expected ||
    primary?.structure === expected
  ) {
    score += 8;
  }

  if (
    intermediate?.trend === expected ||
    intermediate?.structure === expected
  ) {
    score += 4;
  }

  return clamp(
    score,
    0,
    25
  );
}

function scoreStructure(
  direction,
  structures
) {
  if (!structures || !direction) {
    return 0;
  }

  const expected =
    direction === "LONG"
      ? "bullish"
      : "bearish";

  let score = 0;

  const intermediate =
    structures["4h"];

  const trade =
    structures["1h"];

  const execution =
    structures["30m"];

  if (
    intermediate?.direction === expected
  ) {
    score += 8;
  }

  if (
    trade?.direction === expected
  ) {
    score += 7;
  }

  if (
    execution?.direction === expected
  ) {
    score += 5;
  }

  return clamp(
    score,
    0,
    20
  );
}

function scoreLiquidity(
  direction,
  liquidity,
  entry
) {
  if (
    !liquidity ||
    !direction ||
    !finite(entry)
  ) {
    return 0;
  }

  let score = 0;

  const expectedSide =
    direction === "LONG"
      ? "buySide"
      : "sellSide";

  for (
    const timeframe of [
      "1d",
      "4h",
      "1h",
      "30m"
    ]
  ) {
    const data =
      liquidity[timeframe];

    if (
      !data?.valid ||
      !Array.isArray(
        data[expectedSide]
      )
    ) {
      continue;
    }

    const validLevels =
      data[expectedSide].filter(
        (level) => {
          const price =
            Number(
              level?.price
            );

          return (
            finite(price) &&
            (
              direction === "LONG"
                ? price > entry
                : price < entry
            )
          );
        }
      );

    if (validLevels.length > 0) {
      score +=
        timeframe === "1d"
          ? 5
          : timeframe === "4h"
            ? 4
            : timeframe === "1h"
              ? 3
              : 3;
    }
  }

  return clamp(
    score,
    0,
    15
  );
}

function scoreMomentum(
  direction,
  momentum
) {
  if (
    !momentum ||
    !direction
  ) {
    return 0;
  }

  const expected =
    direction === "LONG"
      ? "bullish"
      : "bearish";

  let score = 0;

  if (
    momentum.overall === expected
  ) {
    score += 7;
  }

  const trade =
    momentum.timeframes?.["1h"];

  const execution =
    momentum.timeframes?.["30m"];

  if (
    trade?.direction === expected
  ) {
    score += 5;
  }

  if (
    execution?.direction === expected
  ) {
    score += 3;
  }

  return clamp(
    score,
    0,
    15
  );
}

function scoreExecution(
  direction,
  setup
) {
  if (
    !setup ||
    !direction
  ) {
    return 0;
  }

  let score = 0;

  if (
    setup.confirmation?.tradeBreak === true
  ) {
    score += 8;
  }

  if (
    setup.confirmation?.executionBreak === true
  ) {
    score += 7;
  }

  return clamp(
    score,
    0,
    15
  );
}

function scoreRiskReward(
  riskReward
) {
  if (!finite(riskReward)) {
    return 0;
  }

  const rr = Number(
    riskReward
  );

  if (rr < MIN_RR) {
    return 0;
  }

  /*
   * 2R = 6 points
   * 2.5R+ = 10 points
   */
  if (rr >= 2.5) {
    return 10;
  }

  return 6 +
    Math.round(
      (rr - 2) * 8
    );
}

function gradeScore(score) {
  if (score >= 90) {
    return "A+";
  }

  if (score >= 80) {
    return "A";
  }

  if (score >= 70) {
    return "B";
  }

  if (score >= 60) {
    return "C";
  }

  return "D";
}

function scoreSetup({
  direction,
  context,
  structures,
  liquidity,
  momentum,
  setup,
  riskReward,
  entry,
}) {
  if (
    direction !== "LONG" &&
    direction !== "SHORT"
  ) {
    return {
      valid: false,
      score: 0,
      grade: "D",
      reason: "Invalid setup direction",
    };
  }

  const components = {
    higherTimeframe:
      getDirectionalEvidence(
        direction,
        context
      ),

    structure:
      scoreStructure(
        direction,
        structures
      ),

    liquidity:
      scoreLiquidity(
        direction,
        liquidity,
        entry
      ),

    momentum:
      scoreMomentum(
        direction,
        momentum
      ),

    execution:
      scoreExecution(
        direction,
        setup
      ),

    riskReward:
      scoreRiskReward(
        riskReward
      ),
  };

  const score = clamp(
    Object.values(
      components
    ).reduce(
      (total, value) =>
        total + value,
      0
    ),
    0,
    MAX_SCORE
  );

  const grade =
    gradeScore(score);

  const rrValid =
    finite(riskReward) &&
    Number(riskReward) >= MIN_RR;

  const valid =
    score >= MIN_SCORE &&
    rrValid;

  const reasons = [];

  if (
    components.higherTimeframe > 0
  ) {
    reasons.push(
      "Higher-timeframe alignment"
    );
  }

  if (
    components.structure > 0
  ) {
    reasons.push(
      "Structural confirmation"
    );
  }

  if (
    components.liquidity > 0
  ) {
    reasons.push(
      "Directional liquidity available"
    );
  }

  if (
    components.momentum > 0
  ) {
    reasons.push(
      "Momentum supports direction"
    );
  }

  if (
    components.execution > 0
  ) {
    reasons.push(
      "Execution confirmation"
    );
  }

  if (rrValid) {
    reasons.push(
      `${Number(riskReward).toFixed(2)}R risk/reward`
    );
  } else {
    reasons.push(
      `Risk/reward below ${MIN_RR}R`
    );
  }

  return {
    valid,

    score,

    grade,

    minimumScore:
      MIN_SCORE,

    minimumRiskReward:
      MIN_RR,

    components,

    reasons,

    generatedAt:
      new Date().toISOString(),
  };
}

module.exports = {
  MIN_RR,
  MIN_SCORE,
  MAX_SCORE,
  scoreSetup,
  gradeScore,
};
