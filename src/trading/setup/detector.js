"use strict";

/*
 * KITSETUPS — SETUP DETECTOR
 *
 * Purpose:
 * Determine whether the independently analysed market context,
 * structure, liquidity and momentum form a coherent trade opportunity.
 *
 * This layer does NOT:
 *   - fetch market data
 *   - calculate entries
 *   - calculate stops
 *   - calculate targets
 *   - calculate risk/reward
 *   - manage lifecycle
 *
 * It answers one question:
 *
 *   "Is there enough market evidence for a directional setup?"
 *
 * Timeframe hierarchy:
 *
 *   1W  = macro direction
 *   1D  = primary direction
 *   4H  = structural location
 *   1H  = trade confirmation
 *   30M = execution confirmation
 */

const {
  TIMEFRAMES,
  createWaitResult,
} = require("../contract");

const REQUIRED = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

function normalizeDirection(value) {
  if (value === "bullish" || value === "LONG") {
    return "LONG";
  }

  if (value === "bearish" || value === "SHORT") {
    return "SHORT";
  }

  return null;
}

function getStructureDirection(structure) {
  return normalizeDirection(
    structure?.direction,
  );
}

function getContextDirection(context) {
  return normalizeDirection(
    context?.trend ||
    context?.structure ||
    context?.direction,
  );
}

function getMomentumDirection(momentum) {
  return normalizeDirection(
    momentum?.direction,
  );
}

function hasBullishEvidence({
  context,
  structure,
  momentum,
}) {
  return (
    getContextDirection(context) === "LONG" ||
    getStructureDirection(structure) === "LONG" ||
    getMomentumDirection(momentum) === "LONG"
  );
}

function hasBearishEvidence({
  context,
  structure,
  momentum,
}) {
  return (
    getContextDirection(context) === "SHORT" ||
    getStructureDirection(structure) === "SHORT" ||
    getMomentumDirection(momentum) === "SHORT"
  );
}

function directionalEvidence({
  direction,
  context,
  structures,
  momentum,
}) {
  const index = direction === "LONG" ? 1 : -1;

  const score = {
    macro: 0,
    primary: 0,
    intermediate: 0,
    trade: 0,
    execution: 0,
  };

  const macroContext = context?.["1w"];
  const primaryContext = context?.["1d"];
  const intermediateContext = context?.["4h"];
  const tradeContext = context?.["1h"];
  const executionContext = context?.["30m"];

  const macroStructure = structures?.["1w"];
  const primaryStructure = structures?.["1d"];
  const intermediateStructure = structures?.["4h"];
  const tradeStructure = structures?.["1h"];
  const executionStructure = structures?.["30m"];

  if (
    hasBullishEvidence({
      context: macroContext,
      structure: macroStructure,
      momentum: momentum?.["1w"],
    }) &&
    index === 1
  ) {
    score.macro = 1;
  }

  if (
    hasBearishEvidence({
      context: macroContext,
      structure: macroStructure,
      momentum: momentum?.["1w"],
    }) &&
    index === -1
  ) {
    score.macro = 1;
  }

  if (
    hasBullishEvidence({
      context: primaryContext,
      structure: primaryStructure,
      momentum: momentum?.["1d"],
    }) &&
    index === 1
  ) {
    score.primary = 1;
  }

  if (
    hasBearishEvidence({
      context: primaryContext,
      structure: primaryStructure,
      momentum: momentum?.["1d"],
    }) &&
    index === -1
  ) {
    score.primary = 1;
  }

  if (
    hasBullishEvidence({
      context: intermediateContext,
      structure: intermediateStructure,
      momentum: momentum?.["4h"],
    }) &&
    index === 1
  ) {
    score.intermediate = 1;
  }

  if (
    hasBearishEvidence({
      context: intermediateContext,
      structure: intermediateStructure,
      momentum: momentum?.["4h"],
    }) &&
    index === -1
  ) {
    score.intermediate = 1;
  }

  if (
    hasBullishEvidence({
      context: tradeContext,
      structure: tradeStructure,
      momentum: momentum?.["1h"],
    }) &&
    index === 1
  ) {
    score.trade = 1;
  }

  if (
    hasBearishEvidence({
      context: tradeContext,
      structure: tradeStructure,
      momentum: momentum?.["1h"],
    }) &&
    index === -1
  ) {
    score.trade = 1;
  }

  if (
    hasBullishEvidence({
      context: executionContext,
      structure: executionStructure,
      momentum: momentum?.["30m"],
    }) &&
    index === 1
  ) {
    score.execution = 1;
  }

  if (
    hasBearishEvidence({
      context: executionContext,
      structure: executionStructure,
      momentum: momentum?.["30m"],
    }) &&
    index === -1
  ) {
    score.execution = 1;
  }

  return score;
}

function findDirectionalBias(context) {
  const bias = normalizeDirection(context?.bias);

  if (bias) {
    return bias;
  }

  const macro = getContextDirection(context?.["1w"]);
  const primary = getContextDirection(context?.["1d"]);

  if (macro && primary && macro === primary) {
    return macro;
  }

  return null;
}

function hasStructuralBreak(structure, direction) {
  const bos = structure?.breaks?.bos;

  if (!bos) {
    return false;
  }

  return normalizeDirection(bos.direction) === direction;
}

function hasUsefulLiquidity(liquidity, direction, price) {
  if (!liquidity || !Number.isFinite(Number(price))) {
    return false;
  }

  const currentPrice = Number(price);

  const target =
    direction === "LONG"
      ? liquidity?.nearest?.above
      : liquidity?.nearest?.below;

  if (!target) {
    return false;
  }

  return Number.isFinite(Number(target.price));
}

function detectSetup({
  symbol,
  price,
  context,
  structures,
  liquidity,
  momentum,
}) {
  if (!symbol) {
    throw new Error("symbol is required");
  }

  if (!Number.isFinite(Number(price))) {
    throw new Error("valid price is required");
  }

  const reasons = [];

  const bias = findDirectionalBias(context);

  if (!bias) {
    return createWaitResult({
      symbol,
      price,
      reasons: [
        "No reliable higher-timeframe directional bias",
      ],
    });
  }

  const candidates = [bias];

  /*
   * A reversal is only considered when the primary timeframe
   * provides opposing structural evidence.
   *
   * This prevents lower-timeframe noise from flipping the entire
   * market bias.
   */
  const primaryStructure =
    getStructureDirection(structures?.["1d"]);

  if (
    primaryStructure &&
    primaryStructure !== bias &&
    hasStructuralBreak(
      structures?.["1d"],
      primaryStructure,
    )
  ) {
    candidates.push(primaryStructure);
  }

  const evaluations = candidates.map(
    (direction) => ({
      direction,

      evidence: directionalEvidence({
        direction,
        context: context?.timeframes || context,
        structures,
        momentum: momentum?.timeframes || momentum,
      }),

      liquidity:
        hasUsefulLiquidity(
          liquidity?.["4h"],
          direction,
          price,
        ),

      executionBreak:
        hasStructuralBreak(
          structures?.["30m"],
          direction,
        ),

      tradeBreak:
        hasStructuralBreak(
          structures?.["1h"],
          direction,
        ),
    }),
  );

  /*
   * Prefer the candidate with the strongest hierarchical evidence.
   */
  evaluations.sort(
    (a, b) => {
      const aScore =
        a.evidence.macro * 5 +
        a.evidence.primary * 4 +
        a.evidence.intermediate * 3 +
        a.evidence.trade * 2 +
        a.evidence.execution;

      const bScore =
        b.evidence.macro * 5 +
        b.evidence.primary * 4 +
        b.evidence.intermediate * 3 +
        b.evidence.trade * 2 +
        b.evidence.execution;

      return bScore - aScore;
    },
  );

  const best = evaluations[0];

  if (!best) {
    return createWaitResult({
      symbol,
      price,
      reasons: [
        "No directional candidate identified",
      ],
    });
  }

  /*
   * Quality gate.
   *
   * We require:
   *   - macro OR primary directional support
   *   - intermediate/trade structure support
   *   - execution evidence OR a valid structural transition
   *
   * We deliberately do not require every timeframe to point
   * in exactly the same direction. Markets do not move that way.
   */
  const macroPrimary =
    best.evidence.macro ||
    best.evidence.primary;

  const structuralConfirmation =
    best.evidence.intermediate ||
    best.evidence.trade;

  const executionConfirmation =
    best.evidence.execution ||
    best.executionBreak ||
    best.tradeBreak;

  if (!macroPrimary) {
    reasons.push(
      "Higher-timeframe direction is insufficient",
    );
  }

  if (!structuralConfirmation) {
    reasons.push(
      "4H/1H structure does not confirm the candidate",
    );
  }

  if (!executionConfirmation) {
    reasons.push(
      "30M/1H execution structure has not confirmed",
    );
  }

  if (!best.liquidity) {
    reasons.push(
      "No usable nearby liquidity objective",
    );
  }

  /*
   * The detector only recognizes setups.
   *
   * Entry/stop/target geometry is deliberately left to
   * the following setup modules.
   */
  if (
    !macroPrimary ||
    !structuralConfirmation ||
    !executionConfirmation ||
    !best.liquidity
  ) {
    return createWaitResult({
      symbol,
      price,
      reasons,
    });
  }

  reasons.push(
    `${best.direction} higher-timeframe direction supported`,
  );

  reasons.push(
    "Intermediate/trade structure confirmed",
  );

  reasons.push(
    "Execution structure confirmed",
  );

  reasons.push(
    "Liquidity objective identified",
  );

  return {
    symbol,
    price: Number(price),

    detected: true,

    direction: best.direction,

    evidence: best.evidence,

    liquidity: {
      confirmed: best.liquidity,
    },

    confirmation: {
      tradeBreak: best.tradeBreak,
      executionBreak: best.executionBreak,
    },

    reasons,

    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  REQUIRED,
  detectSetup,
};
