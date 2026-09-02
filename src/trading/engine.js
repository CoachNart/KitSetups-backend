"use strict";

/*
 * ============================================================
 * KITSETUPS — CLEAN TRADING ENGINE
 * ============================================================
 *
 * This file is the single orchestration layer for the new
 * trading system.
 *
 * It does NOT contain trading rules.
 *
 * Each specialist owns one responsibility:
 *
 * marketData  -> raw closed-market data
 * context     -> timeframe hierarchy / directional context
 * structure   -> market structure
 * liquidity   -> liquidity objectives
 * momentum    -> momentum state
 * detector    -> setup detection
 * entry       -> executable entry
 * stop        -> structural invalidation
 * targets     -> directional objectives / RR
 * scorer      -> setup quality
 *
 * The engine only connects those contracts.
 *
 * Minimum timeframe:
 *
 * 1W -> 1D -> 4H -> 1H -> 30M
 * ============================================================
 */

const {
  getMarketData,
} = require("./data/marketData");

const {
  analyzeContext,
} = require("./analysis/context");

const {
  analyzeAllStructures,
} = require("./analysis/structure");

const {
  analyzeAllLiquidity,
} = require("./analysis/liquidity");

const {
  analyzeMomentum,
} = require("./analysis/momentum");

const {
  detectSetup,
} = require("./setup/detector");

const {
  calculateEntry,
} = require("./setup/entry");

const {
  calculateStop,
} = require("./setup/stop");

const {
  buildTargets,
} = require("./setup/targets");

const {
  scoreSetup,
} = require("./quality/scorer");


function reject(
  symbol,
  price,
  stage,
  reason,
  extra = {}
) {
  const setup = extra.setup || null;
  const entryResult = extra.entry || null;
  const stopResult = extra.stop || null;
  const targetsResult = extra.targets || null;

  return {
    symbol,
    price,

    status: "WAIT",
    valid: false,

    direction:
      setup?.direction || null,

    entry:
      entryResult?.valid === true
        ? entryResult.price ?? null
        : null,

    stop:
      stopResult?.valid === true
        ? stopResult.stop ?? null
        : null,

    targets:
      targetsResult?.valid === true &&
      Array.isArray(targetsResult.targets)
        ? targetsResult.targets
        : [],

    riskReward:
      targetsResult?.valid === true
        ? targetsResult.riskReward ?? null
        : null,

    stage,
    reason,

    context: extra.context || null,
    structures: extra.structures || null,
    liquidity: extra.liquidity || null,
    momentum: extra.momentum || null,
    setup,
    
    generatedAt:
      new Date().toISOString(),
  };
}

/*
 * ------------------------------------------------------------
 * FINAL SETUP BUILDER
 * ------------------------------------------------------------
 *
 * This is the only place where the independent outputs become
 * one trade setup.
 */
function buildFinalSetup({
  marketData,
  context,
  structures,
  liquidity,
  momentum,
  setup,
  entry,
  stop,
  targets,
  quality,
}) {
  const symbol =
    marketData.symbol;

  const price =
    Number(marketData.ticker.lastPrice);

  const direction =
    setup.direction;

  const lifecycleTargets =
    (targets.targets || []).map(
      (target) => ({
        index: target.index,
        price: target.price,
        hit: false,
        hitAt: null,
      })
    );

  return {
    symbol,

    price,

    status: "READY",

    valid: true,

    direction,

    entry:
      entry.price,

    stop:
      stop.stop,

    targets:
      targets.targets,

    riskReward:
      targets.riskReward,

    quality: {
      score:
        quality.score,

      grade:
        quality.grade,

      components:
        quality.components,
    },

    reasons: [
      ...setup.reasons,
      ...entry.reason
        ? [entry.reason]
        : [],
      ...stop.reason
        ? [stop.reason]
        : [],
      ...targets.reason
        ? [targets.reason]
        : [],
      ...quality.reasons,
    ],

    evidence: {
      context,
      structures,
      liquidity,
      momentum,
      setup,
      entry,
      stop,
      targets,
    },

    lifecycle: {
      status: "READY",

      entryHit: false,
      entryHitAt: null,

      targets:
        lifecycleTargets,

      stopLossHit: false,
      stopLossHitAt: null,

      outcome: null,
      closedAt: null,

      lastPrice: price,

      lastCheckedAt:
        new Date().toISOString(),
    },

    generatedAt:
      new Date().toISOString(),
  };
}


/*
 * ------------------------------------------------------------
 * MAIN ENGINE
 * ------------------------------------------------------------
 */
async function analyzeSymbol(symbol) {
  if (!symbol) {
    throw new Error(
      "symbol is required"
    );
  }

  /*
   * 1. MARKET DATA
   */
  const marketData =
    await getMarketData(symbol);

  const price =
    Number(
      marketData?.ticker?.lastPrice
    );

  if (!Number.isFinite(price)) {
    return reject(
      symbol,
      null,
      "marketData",
      "Invalid market price"
    );
  }

  /*
   * 2. CONTEXT
   */
  const context =
    analyzeContext(
      marketData
    );

  /*
   * No directional context means there is no reason to
   * manufacture a trade.
   */
  if (
    context.bias !== "bullish" &&
    context.bias !== "bearish"
  ) {
    return reject(
      symbol,
      price,
      "context",
      "No reliable directional bias",
      {
        context,
      }
    );
  }

  /*
   * 3. STRUCTURE
   */
  const structures =
    analyzeAllStructures(
      marketData
    );

  /*
   * 4. LIQUIDITY
   */
  const liquidity =
    analyzeAllLiquidity(
      marketData,
      structures
    );

  /*
   * 5. MOMENTUM
   */
  const momentum =
    analyzeMomentum(
      marketData
    );

  /*
   * 6. SETUP DETECTION
   */
  const setup =
    detectSetup({
      symbol,

      price,

      context,

      structures,

      liquidity,

      momentum,
    });

  if (
    !setup ||
    setup.detected !== true
  ) {
    return reject(
      symbol,
      price,
      "detector",
      setup?.reason ||
        "No valid setup detected",
      {
        context,
        structures,
        liquidity,
        momentum,
        setup,
      }
    );
  }

  /*
   * 7. ENTRY
   */
  const entry =
    calculateEntry({
      symbol,

      price,

      direction:
        setup.direction,

      context,

      structures,

      liquidity,

      setup,
    });

  if (
    !entry ||
    entry.valid !== true
  ) {
    return reject(
      symbol,
      price,
      "entry",
      entry?.reason ||
        "No executable entry",
      {
        context,
        structures,
        liquidity,
        momentum,
        setup,
        entry,
      }
    );
  }

  /*
   * 8. STOP
   */
  const stop =
    calculateStop({
      symbol,

      price,

      direction:
        setup.direction,

      entry:
        entry.price,

      context,

      structures,

      liquidity,
    });

  if (
    !stop ||
    stop.valid !== true
  ) {
    return reject(
      symbol,
      price,
      "stop",
      stop?.reason ||
        "No valid structural stop",
      {
        setup,
        entry,
        stop,
      }
    );
  }

  /*
   * 9. TARGETS
   *
   * Targets are responsible for determining whether the
   * available directional objectives provide acceptable RR.
   */
  const targets =
    buildTargets({
      symbol,

      price,

      direction:
        setup.direction,

      entry:
        entry.price,

      stop:
        stop.stop,

      context,

      structures,

      liquidity,

      setup,
    });

  const minimumRR = 2;
  const firstTargetRR =
    Number(targets?.targets?.[0]?.riskReward);

  if (
    !targets ||
    targets.valid !== true ||
    !Number.isFinite(firstTargetRR) ||
    firstTargetRR < minimumRR
  ) {
    return reject(
      symbol,
      price,
      "targets",
      targets?.reason ||
        "No acceptable directional target",
      {
        setup,
        entry,
        stop,
        targets,
      }
    );
  }

  /*
   * 10. QUALITY
   */
  const quality =
    scoreSetup({
      direction:
        setup.direction,

      context,

      structures,

      liquidity,

      momentum,

      setup,

      riskReward:
        targets.riskReward,

      entry:
        entry.price,
    });

  if (
    !quality.valid
  ) {
    return reject(
      symbol,
      price,
      "quality",
      "Setup quality below publication threshold",
      {
        setup,
        entry,
        stop,
        targets,
        quality,
      }
    );
  }

  /*
   * 11. FINAL SETUP
   */
  return buildFinalSetup({
    marketData,

    context,

    structures,

    liquidity,

    momentum,

    setup,

    entry,

    stop,

    targets,

    quality,
  });
}


module.exports = {
  analyzeSymbol,
  buildFinalSetup,
};
