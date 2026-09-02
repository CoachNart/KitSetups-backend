"use strict";

/*
 * ============================================================
 * KITSETUPS — QUALITY SCORER
 * ============================================================
 *
 * Purpose:
 * Evaluate setup quality based on market evidence.
 *
 * Scoring factors:
 * - Structural alignment (context + structure agreement)
 * - Liquidity strength (distance to nearest target)
 * - Momentum confirmation (multiple timeframes)
 * - Risk/reward ratio (higher = better)
 * - Execution precision (entry zone size)
 *
 * Output: Grade (A+ / A / B / C) + numeric score (0-100)
 * ============================================================
 */

const GRADE_THRESHOLDS = Object.freeze({
  A_PLUS: 85,
  A: 70,
  B: 55,
  C: 40,
});

function finite(value) {
  return Number.isFinite(Number(value));
}

function scoreStructuralAlignment({
  direction,
  context,
  structures,
}) {
  if (!context || !structures) {
    return 0;
  }

  let points = 0;

  // Check timeframe agreement
  const macroDirection = context["1w"]?.bias;
  const primaryDirection = context["1d"]?.bias;
  const intermediateDirection = structures["4h"]?.direction;

  if (
    macroDirection === "bullish" &&
    primaryDirection === "bullish" &&
    direction === "LONG"
  ) {
    points += 25;
  } else if (
    macroDirection === "bearish" &&
    primaryDirection === "bearish" &&
    direction === "SHORT"
  ) {
    points += 25;
  } else if (
    primaryDirection === direction?.toLowerCase()
  ) {
    points += 15;
  }

  // Check intermediate structure
  if (
    intermediateDirection === direction?.toLowerCase()
  ) {
    points += 15;
  }

  return Math.min(40, points);
}

function scoreLiquidity({
  liquidity,
  direction,
  entry,
}) {
  if (!liquidity || !entry) {
    return 0;
  }

  const targetLiquidity =
    direction === "LONG"
      ? liquidity?.nearest?.above
      : liquidity?.nearest?.below;

  if (!targetLiquidity) {
    return 0;
  }

  const distance = Math.abs(
    Number(targetLiquidity.price) - Number(entry)
  ) / Number(entry);

  // Closer liquidity = better setup
  if (distance < 0.01) return 20; // < 1%
  if (distance < 0.03) return 15; // < 3%
  if (distance < 0.05) return 10; // < 5%
  if (distance < 0.10) return 5; // < 10%
  return 0;
}

function scoreMomentum({
  momentum,
  direction,
}) {
  if (!momentum) {
    return 0;
  }

  let points = 0;

  // Check overall momentum
  if (momentum.overall === "bullish" && direction === "LONG") {
    points += 15;
  } else if (momentum.overall === "bearish" && direction === "SHORT") {
    points += 15;
  }

  // Check execution momentum (1H + 30M)
  const executionMomentum = [
    momentum.timeframes?.["1h"],
    momentum.timeframes?.["30m"],
  ].filter((m) => m && m.sufficientData);

  const bullishExecutionVotes = executionMomentum.filter(
    (m) => m.direction === "bullish"
  ).length;

  const bearishExecutionVotes = executionMomentum.filter(
    (m) => m.direction === "bearish"
  ).length;

  if (
    direction === "LONG" &&
    bullishExecutionVotes > bearishExecutionVotes
  ) {
    points += 10;
  } else if (
    direction === "SHORT" &&
    bearishExecutionVotes > bullishExecutionVotes
  ) {
    points += 10;
  }

  return Math.min(25, points);
}

function scoreRiskReward({
  riskReward,
}) {
  if (!finite(riskReward)) {
    return 0;
  }

  const rr = Number(riskReward);

  // Diminishing returns on RR
  if (rr >= 4.0) return 20;
  if (rr >= 3.0) return 18;
  if (rr >= 2.5) return 15;
  if (rr >= 2.0) return 12;
  if (rr >= 1.5) return 8;
  return 0;
}

function scoreExecution({
  entry,
  stop,
  direction,
}) {
  if (!finite(entry) || !finite(stop)) {
    return 0;
  }

  const distance =
    direction === "LONG"
      ? (Number(entry) - Number(stop)) / Number(entry)
      : (Number(stop) - Number(entry)) / Number(entry);

  // Tighter stop = more precise execution
  if (distance < 0.005) return 15; // < 0.5%
  if (distance < 0.010) return 12; // < 1.0%
  if (distance < 0.020) return 8; // < 2.0%
  if (distance < 0.050) return 4; // < 5.0%
  return 0;
}

function gradeFromScore(score) {
  if (score >= GRADE_THRESHOLDS.A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLDS.A) return "A";
  if (score >= GRADE_THRESHOLDS.B) return "B";
  if (score >= GRADE_THRESHOLDS.C) return "C";
  return "WATCH";
}

function scoreSetup({
  direction,
  context,
  structures,
  liquidity,
  momentum,
  riskReward,
  entry,
  stop,
}) {
  const components = {
    structural: scoreStructuralAlignment({
      direction,
      context,
      structures,
    }),
    liquidity: scoreLiquidity({
      liquidity: liquidity?.["4h"],
      direction,
      entry,
    }),
    momentum: scoreMomentum({
      momentum,
      direction,
    }),
    riskReward: scoreRiskReward({ riskReward }),
    execution: scoreExecution({
      entry,
      stop,
      direction,
    }),
  };

  const score =
    components.structural +
    components.liquidity +
    components.momentum +
    components.riskReward +
    components.execution;

  const grade = gradeFromScore(score);

  const valid =
    score >= GRADE_THRESHOLDS.C &&
    grade !== "WATCH";

  const reasons = [];

  if (components.structural === 0) {
    reasons.push(
      "Timeframe structure does not fully align"
    );
  }

  if (components.liquidity === 0) {
    reasons.push(
      "No nearby directional liquidity for target"
    );
  }

  if (components.momentum === 0) {
    reasons.push(
      "Execution timeframes lack directional momentum"
    );
  }

  if (riskReward < 2) {
    reasons.push(
      `Risk/reward insufficient: ${riskReward}R < 2R required`
    );
  }

  return {
    score: Math.round(score),
    grade,
    components,
    valid,
    reasons,
  };
}

module.exports = {
  GRADE_THRESHOLDS,
  scoreSetup,
};
