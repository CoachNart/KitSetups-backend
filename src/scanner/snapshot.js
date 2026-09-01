"use strict";

/*
 * ============================================================
 * KITSETUPS — SCANNER SNAPSHOT
 * ============================================================
 *
 * Converts one trading-engine result into a stable scanner
 * snapshot.
 *
 * The scanner should never need to understand the internals
 * of context, structure, liquidity, momentum, entry, stop,
 * targets, or scoring.
 * ============================================================
 */

function validResult(result) {
  return (
    result &&
    typeof result === "object" &&
    typeof result.symbol === "string"
  );
}

function createSnapshot(result) {
  if (!validResult(result)) {
    throw new Error(
      "valid trading engine result is required"
    );
  }

  const snapshot = {
    symbol: result.symbol,
    price: Number(result.price),
    status: result.status || "WAIT",
    valid: result.valid === true,

    direction:
      result.direction || null,

    entry:
      Number.isFinite(Number(result.entry))
        ? Number(result.entry)
        : null,

    stop:
      Number.isFinite(Number(result.stop))
        ? Number(result.stop)
        : null,

    targets:
      Array.isArray(result.targets)
        ? result.targets.map((target) => ({
            index: target.index,
            price: Number(target.price),
            timeframe: target.timeframe || null,
            type: target.type || null,
            side: target.side || null,
            riskReward:
              Number.isFinite(
                Number(target.riskReward)
              )
                ? Number(target.riskReward)
                : null,
          }))
        : [],

    riskReward:
      Number.isFinite(Number(result.riskReward))
        ? Number(result.riskReward)
        : null,

    quality: result.quality
      ? {
          score:
            Number(result.quality.score) || 0,
          grade:
            result.quality.grade || null,
        }
      : null,

    stage:
      result.stage || null,

    reason:
      result.reason || null,

    lifecycle:
      result.lifecycle
        ? {
            status:
              result.lifecycle.status || null,
            entryHit:
              result.lifecycle.entryHit === true,
            entryHitAt:
              result.lifecycle.entryHitAt || null,
            targets:
              Array.isArray(result.lifecycle.targets)
                ? result.lifecycle.targets.map((target) => ({
                    index: target.index,
                    price: Number(target.price),
                    hit: target.hit === true,
                    hitAt: target.hitAt || null,
                  }))
                : [],
            stopLossHit:
              result.lifecycle.stopLossHit === true,
            stopLossHitAt:
              result.lifecycle.stopLossHitAt || null,
            outcome:
              result.lifecycle.outcome || null,
            closedAt:
              result.lifecycle.closedAt || null,
          }
        : null,

    generatedAt:
      result.generatedAt ||
      new Date().toISOString(),

    snapshotAt:
      new Date().toISOString(),
  };

  return snapshot;
}

module.exports = {
  createSnapshot,
};
