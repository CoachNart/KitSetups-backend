const TIMEFRAME_WEIGHT = {
  "1w": 5,
  "1d": 4,
  "4h": 3,
  "1h": 2,
  "30m": 1,
};

const MIN_ACTIONABLE_CONFIDENCE = 70;

function isDirection(value) {
  return (
    value === "BULLISH" ||
    value === "BEARISH"
  );
}

function opposite(value) {
  if (value === "BULLISH") return "BEARISH";
  if (value === "BEARISH") return "BULLISH";
  return "NEUTRAL";
}

function getState(structure) {
  return (
    structure?.state ||
    structure?.trend ||
    "UNKNOWN"
  );
}

function calculateRegime(structures) {
  let bullish = 0;
  let bearish = 0;
  let total = 0;

  for (const [tf, structure] of Object.entries(
    structures || {}
  )) {
    const weight =
      TIMEFRAME_WEIGHT[tf] || 1;

    const state =
      getState(structure);

    if (
      state === "BULLISH" ||
      state === "BEARISH"
    ) {
      total += weight;
    }

    if (state === "BULLISH") {
      bullish += weight;
    }

    if (state === "BEARISH") {
      bearish += weight;
    }
  }

  if (!total) {
    return {
      direction: "NEUTRAL",
      score: 0,
      bullishWeight: 0,
      bearishWeight: 0,
    };
  }

  const direction =
    bullish > bearish
      ? "BULLISH"
      : bearish > bullish
        ? "BEARISH"
        : "NEUTRAL";

  const dominant =
    Math.max(bullish, bearish);

  /*
   * This is a regime-strength measure,
   * NOT a probability of winning.
   *
   * It must never be presented as
   * "100% chance of success".
   */
  const score = Math.round(
    (dominant / total) * 100
  );

  return {
    direction,
    score,
    bullishWeight: bullish,
    bearishWeight: bearish,
  };
}

function findRelevantTimeframes(
  structures,
  direction
) {
  return Object.entries(
    structures || {}
  )
    .filter(
      ([, structure]) =>
        getState(structure) === direction
    )
    .map(([tf]) => tf);
}

function evaluateLiquidity(
  liquidity,
  direction
) {
  const sweep =
    liquidity?.strongestSweep || null;

  if (!sweep) {
    return {
      valid: false,
      score: 0,
      reason: "NO_LIQUIDITY_SWEEP",
      sweep: null,
    };
  }

  if (
    sweep.direction !== direction
  ) {
    return {
      valid: false,
      score: 0,
      reason:
        "LIQUIDITY_DIRECTION_CONFLICT",
      sweep,
    };
  }

  let score = 40;

  if (
    sweep.confirmation ===
    "WICK_AND_CLOSE"
  ) {
    score += 20;
  }

  if (
    sweep.class === "EXTERNAL"
  ) {
    score += 20;
  }

  if (
    sweep.source === "EQUAL_HIGH" ||
    sweep.source === "EQUAL_LOW"
  ) {
    score += 20;
  }

  return {
    valid: true,
    score: Math.min(score, 100),
    reason: "LIQUIDITY_CONFIRMED",
    sweep,
  };
}

function evaluateDisplacement(
  displacement,
  direction
) {
  if (!displacement) {
    return {
      valid: false,
      score: 0,
      reason:
        "NO_CONTEXTUAL_DISPLACEMENT",
      displacement: null,
    };
  }

  if (
    displacement.direction !==
    direction
  ) {
    return {
      valid: false,
      score: 0,
      reason:
        "DISPLACEMENT_DIRECTION_CONFLICT",
      displacement,
    };
  }

  return {
    valid: true,
    score:
      Number(displacement.score) || 0,
    reason:
      "CONTEXTUAL_DISPLACEMENT_CONFIRMED",
    displacement,
  };
}

function evaluateStructure(
  structure,
  direction
) {
  if (!structure) {
    return {
      valid: false,
      score: 0,
      reason: "NO_STRUCTURE",
    };
  }

  const state =
    getState(structure);

  if (state !== direction) {
    return {
      valid: false,
      score: 0,
      reason:
        "LOCAL_STRUCTURE_CONFLICT",
    };
  }

  const events =
    structure.events ||
    structure.breaks ||
    [];

  const confirmation =
    events.find(
      event =>
        event &&
        event.direction ===
          direction &&
        (
          event.type === "BOS" ||
          event.type === "CHOCH"
        ) &&
        (
          event.confirmation ===
            "CLOSE" ||
          event.confirmation ===
            undefined
        )
    );

  if (!confirmation) {
    return {
      valid: false,
      score: Number(
        structure.confidence
      ) || 0,
      reason:
        "NO_STRUCTURAL_CONFIRMATION",
    };
  }

  return {
    valid: true,
    score: Math.min(
      100,
      (Number(
        structure.confidence
      ) || 0) + 25
    ),
    reason:
      "STRUCTURAL_CONFIRMATION_FOUND",
    event: confirmation,
  };
}

function evaluateHTFAlignment(
  structures,
  direction,
  executionTimeframe
) {
  const higherTimeframes =
    Object.entries(
      structures || {}
    ).filter(([tf]) => {
      if (
        tf === executionTimeframe
      ) {
        return false;
      }

      return (
        TIMEFRAME_WEIGHT[tf] >
        (
          TIMEFRAME_WEIGHT[
            executionTimeframe
          ] || 1
        )
      );
    });

  if (!higherTimeframes.length) {
    return {
      valid: true,
      score: 50,
      reason: "NO_HIGHER_TF_CONFLICT",
    };
  }

  let aligned = 0;
  let considered = 0;

  for (
    const [, structure]
    of higherTimeframes
  ) {
    const state =
      getState(structure);

    if (
      state === "BULLISH" ||
      state === "BEARISH"
    ) {
      considered++;

      if (state === direction) {
        aligned++;
      }
    }
  }

  if (!considered) {
    return {
      valid: true,
      score: 50,
      reason:
        "HIGHER_TF_DATA_INSUFFICIENT",
    };
  }

  const alignment =
    aligned / considered;

  if (alignment < 0.5) {
    return {
      valid: false,
      score: Math.round(
        alignment * 100
      ),
      reason:
        "HIGHER_TF_CONFLICT",
    };
  }

  return {
    valid: true,
    score: Math.round(
      alignment * 100
    ),
    reason:
      "HIGHER_TF_ALIGNED",
  };
}

/*
 * Confidence is an evidence score.
 *
 * It is NOT:
 * - win probability
 * - guaranteed return
 * - statistical probability
 *
 * Hard gates still control whether
 * a setup can become actionable.
 */
function calculateConfluenceScore({
  regime,
  liquidity,
  displacement,
  structure,
  alignment,
}) {
  const components = {
    regime: regime.score,
    liquidity: liquidity.score,
    displacement: displacement.score,
    structure: structure.score,
    alignment: alignment.score,
  };

  /*
   * Regime: 25%
   * Liquidity: 20%
   * Displacement: 25%
   * Structure: 20%
   * HTF alignment: 10%
   */
  const score = Math.round(
    components.regime * 0.25 +
    components.liquidity * 0.20 +
    components.displacement * 0.25 +
    components.structure * 0.20 +
    components.alignment * 0.10
  );

  return {
    score: Math.min(
      100,
      Math.max(0, score)
    ),
    components,
  };
}

function analyzeConfluence({
  structures,
  timeframe,
  liquidity,
  displacement,
}) {
  const regime =
    calculateRegime(
      structures
    );

  const sweep =
    liquidity?.strongestSweep;

  /*
   * Without a directional liquidity event,
   * we cannot even begin a setup.
   */
  if (!sweep) {
    return {
      status: "REJECTED",
      signal: "NO_TRADE",
      reason: "NO_LIQUIDITY_EVENT",
      regime,
      gates: {
        liquidity: false,
        displacement: false,
        structure: false,
        alignment: false,
      },
    };
  }

  const direction =
    sweep.direction;

  if (!isDirection(direction)) {
    return {
      status: "REJECTED",
      signal: "NO_TRADE",
      reason: "INVALID_DIRECTION",
      regime,
    };
  }

  const liquidityResult =
    evaluateLiquidity(
      liquidity,
      direction
    );

  const displacementResult =
    evaluateDisplacement(
      displacement,
      direction
    );

  const structureResult =
    evaluateStructure(
      structures?.[timeframe],
      direction
    );

  const alignmentResult =
    evaluateHTFAlignment(
      structures,
      direction,
      timeframe
    );

  /*
   * Hard gates.
   */
  const hardGates = {
    liquidity:
      liquidityResult.valid,

    displacement:
      displacementResult.valid,

    structure:
      structureResult.valid,

    alignment:
      alignmentResult.valid,
  };

  const allHardGates =
    Object.values(
      hardGates
    ).every(Boolean);

  const confluence =
    calculateConfluenceScore({
      regime,
      liquidity:
        liquidityResult,
      displacement:
        displacementResult,
      structure:
        structureResult,
      alignment:
        alignmentResult,
    });

  if (!allHardGates) {
    return {
      status: "REJECTED",
      signal: "NO_TRADE",
      reason:
        !liquidityResult.valid
          ? liquidityResult.reason
          : !displacementResult.valid
            ? displacementResult.reason
            : !structureResult.valid
              ? structureResult.reason
              : alignmentResult.reason,

      direction,
      timeframe,
      regime,

      confluence,

      gates: hardGates,

      evidence: {
        liquidity:
          liquidityResult,
        displacement:
          displacementResult,
        structure:
          structureResult,
        alignment:
          alignmentResult,
      },
    };
  }

  if (
    confluence.score <
    MIN_ACTIONABLE_CONFIDENCE
  ) {
    return {
      status: "REJECTED",
      signal: "NO_TRADE",
      reason:
        "CONFLUENCE_BELOW_ACTIONABLE_THRESHOLD",

      direction,
      timeframe,
      regime,
      confluence,
      gates: hardGates,
    };
  }

  return {
    status: "QUALIFIED",
    signal:
      direction === "BULLISH"
        ? "LONG"
        : "SHORT",

    direction,
    timeframe,
    regime,

    confluence,

    gates: hardGates,

    evidence: {
      liquidity:
        liquidityResult,
      displacement:
        displacementResult,
      structure:
        structureResult,
      alignment:
        alignmentResult,
    },
  };
}

module.exports = {
  calculateRegime,
  evaluateLiquidity,
  evaluateDisplacement,
  evaluateStructure,
  evaluateHTFAlignment,
  calculateConfluenceScore,
  analyzeConfluence,
  MIN_ACTIONABLE_CONFIDENCE,
};
