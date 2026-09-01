"use strict";

/*
 * KITSETUPS — TRADING CONTRACT
 *
 * This file defines the vocabulary and invariants of the new trading engine.
 *
 * Timeframe hierarchy:
 *   1W  → macro
 *   1D  → primary
 *   4H  → intermediate
 *   1H  → trade
 *   30M → execution
 *
 * The contract contains NO trading decisions.
 * It only defines what a valid engine result looks like.
 */

const TIMEFRAMES = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

const HIERARCHY = Object.freeze({
  macro: "1w",
  primary: "1d",
  intermediate: "4h",
  trade: "1h",
  execution: "30m",
});

const DIRECTIONS = Object.freeze([
  "LONG",
  "SHORT",
]);

const SETUP_STATES = Object.freeze([
  "WAIT",
  "READY",
]);

const LIFECYCLE_STATES = Object.freeze([
  "READY",
  "OPEN",
  "TP1_HIT",
  "TP2_HIT",
  "TP3_HIT",
  "STOPPED",
  "MISSED",
  "CLOSED",
]);

const MINIMUM_RISK_REWARD = 2;

function isDirection(value) {
  return DIRECTIONS.includes(value);
}

function isTimeframe(value) {
  return TIMEFRAMES.includes(value);
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function validatePriceLevels({
  direction,
  entry,
  stop,
  targets,
}) {
  if (!isDirection(direction)) {
    return {
      valid: false,
      reason: "Invalid direction",
    };
  }

  if (!isFiniteNumber(entry) || !isFiniteNumber(stop)) {
    return {
      valid: false,
      reason: "Entry and stop must be finite numbers",
    };
  }

  if (!Array.isArray(targets) || targets.length === 0) {
    return {
      valid: false,
      reason: "At least one target is required",
    };
  }

  const e = Number(entry);
  const s = Number(stop);

  if (direction === "LONG" && s >= e) {
    return {
      valid: false,
      reason: "LONG stop must be below entry",
    };
  }

  if (direction === "SHORT" && s <= e) {
    return {
      valid: false,
      reason: "SHORT stop must be above entry",
    };
  }

  for (const target of targets) {
    const price = Number(target?.price);

    if (!Number.isFinite(price)) {
      return {
        valid: false,
        reason: "Invalid target price",
      };
    }

    if (direction === "LONG" && price <= e) {
      return {
        valid: false,
        reason: "LONG targets must be above entry",
      };
    }

    if (direction === "SHORT" && price >= e) {
      return {
        valid: false,
        reason: "SHORT targets must be below entry",
      };
    }
  }

  return {
    valid: true,
    reason: null,
  };
}

function calculateRiskReward({
  direction,
  entry,
  stop,
  target,
}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);

  const risk = Math.abs(e - s);
  const reward = Math.abs(t - e);

  if (
    !Number.isFinite(risk) ||
    !Number.isFinite(reward) ||
    risk <= 0
  ) {
    return null;
  }

  return Number((reward / risk).toFixed(4));
}

function createWaitResult({
  symbol,
  price,
  reasons = [],
}) {
  return {
    symbol,
    price,

    status: "WAIT",

    direction: null,

    entry: null,
    stop: null,
    targets: [],

    riskReward: null,

    quality: null,

    reasons: Array.isArray(reasons)
      ? reasons
      : [],

    lifecycle: null,

    generatedAt: new Date().toISOString(),
  };
}

function createSetupResult({
  symbol,
  price,
  direction,
  entry,
  stop,
  targets,
  quality,
  reasons = [],
}) {
  const validation = validatePriceLevels({
    direction,
    entry,
    stop,
    targets,
  });

  if (!validation.valid) {
    throw new Error(
      `Invalid setup contract: ${validation.reason}`,
    );
  }

  const normalizedTargets = targets.map(
    (target, index) => ({
      index: index + 1,
      price: Number(target.price),
      reason: target.reason || null,
    }),
  );

  const riskReward = calculateRiskReward({
    direction,
    entry,
    stop,
    target: normalizedTargets[0].price,
  });

  return {
    symbol,
    price,

    status: "READY",

    direction,

    entry: Number(entry),
    stop: Number(stop),

    targets: normalizedTargets,

    riskReward,

    quality: quality || null,

    reasons: Array.isArray(reasons)
      ? reasons
      : [],

    lifecycle: {
      status: "READY",
      entryHit: false,
      entryHitAt: null,

      targets: normalizedTargets.map(
        (target) => ({
          index: target.index,
          price: target.price,
          hit: false,
          hitAt: null,
        }),
      ),

      stopLossHit: false,
      stopLossHitAt: null,

      outcome: null,
      closedAt: null,

      lastPrice: Number(price),
      lastCheckedAt: new Date().toISOString(),
    },

    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  TIMEFRAMES,
  HIERARCHY,
  DIRECTIONS,
  SETUP_STATES,
  LIFECYCLE_STATES,
  MINIMUM_RISK_REWARD,

  isDirection,
  isTimeframe,
  isFiniteNumber,

  validatePriceLevels,
  calculateRiskReward,

  createWaitResult,
  createSetupResult,
};
