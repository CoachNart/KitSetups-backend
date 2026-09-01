"use strict";

/*
 * ============================================================
 * KITSETUPS — TARGET ENGINE
 * ============================================================
 *
 * Responsibility:
 *
 * Given a detected directional setup, determine realistic
 * profit objectives using ONLY market-derived liquidity and
 * structure.
 *
 * This module does NOT:
 * - create a trade direction
 * - move the stop
 * - invent targets
 * - force a trade
 * - modify market structure
 *
 * Directional rules:
 *
 * LONG:
 *   targets MUST be above entry.
 *   Prefer buy-side liquidity / upside structural objectives.
 *
 * SHORT:
 *   targets MUST be below entry.
 *   Prefer sell-side liquidity / downside structural objectives.
 *
 * Quality rule:
 *
 * The primary target must provide at least MIN_RR.
 *
 * If the market does not provide enough room,
 * the setup is rejected.
 */

const MIN_RR = 2.0;
const MAX_TARGETS = 3;

const TIMEFRAME_PRIORITY = Object.freeze([
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function priceOf(level) {
  if (!level) {
    return null;
  }

  const value =
    level.price ??
    level.level ??
    level.value;

  return finite(value)
    ? Number(value)
    : null;
}

function calculateRR(entry, stop, target, direction) {
  const risk =
    direction === "LONG"
      ? entry - stop
      : stop - entry;

  if (!finite(risk) || risk <= 0) {
    return null;
  }

  const reward =
    direction === "LONG"
      ? target - entry
      : entry - target;

  if (!finite(reward) || reward <= 0) {
    return null;
  }

  return Number((reward / risk).toFixed(4));
}

function isDirectionalTarget(
  direction,
  entry,
  price
) {
  if (
    !finite(entry) ||
    !finite(price)
  ) {
    return false;
  }

  if (direction === "LONG") {
    return price > entry;
  }

  if (direction === "SHORT") {
    return price < entry;
  }

  return false;
}

function collectLiquidityCandidates(
  liquidity,
  direction,
  entry
) {
  const candidates = [];

  for (const timeframe of TIMEFRAME_PRIORITY) {
    const data = liquidity?.[timeframe];

    if (!data?.valid) {
      continue;
    }

    /*
     * LONG → buy-side liquidity above price.
     * SHORT → sell-side liquidity below price.
     */
    const levels =
      direction === "LONG"
        ? data.buySide
        : data.sellSide;

    if (!Array.isArray(levels)) {
      continue;
    }

    for (const level of levels) {
      const price = priceOf(level);

      if (
        !isDirectionalTarget(
          direction,
          entry,
          price
        )
      ) {
        continue;
      }

      candidates.push({
        price,
        timeframe,
        type:
          level.type ||
          level.kind ||
          "liquidity",
        side:
          level.side ||
          (
            direction === "LONG"
              ? "buy_side"
              : "sell_side"
          ),
        source: "liquidity",
      });
    }
  }

  return candidates;
}

function collectStructureCandidates(
  structures,
  direction,
  entry
) {
  const candidates = [];

  for (const timeframe of TIMEFRAME_PRIORITY) {
    const structure =
      structures?.[timeframe];

    if (!structure?.valid) {
      continue;
    }

    const highs =
      structure?.swings?.highs || [];

    const lows =
      structure?.swings?.lows || [];

    /*
     * LONG targets use highs.
     * SHORT targets use lows.
     */
    const levels =
      direction === "LONG"
        ? highs
        : lows;

    for (const level of levels) {
      const price = priceOf(level);

      if (
        !isDirectionalTarget(
          direction,
          entry,
          price
        )
      ) {
        continue;
      }

      candidates.push({
        price,
        timeframe,
        type:
          direction === "LONG"
            ? "swing_high"
            : "swing_low",
        side:
          direction === "LONG"
            ? "buy_side"
            : "sell_side",
        source: "structure",
      });
    }
  }

  return candidates;
}

function deduplicateCandidates(
  candidates
) {
  const map = new Map();

  for (const candidate of candidates) {
    const key = `${candidate.price}`;

    const existing = map.get(key);

    if (!existing) {
      map.set(key, candidate);
      continue;
    }

    /*
     * Liquidity is preferred over generic structure
     * when both identify the same price.
     */
    if (
      existing.source !== "liquidity" &&
      candidate.source === "liquidity"
    ) {
      map.set(key, candidate);
    }
  }

  return [...map.values()];
}

function sortDirectionalCandidates(
  candidates,
  direction,
  entry
) {
  return candidates.sort((a, b) => {
    const distanceA =
      Math.abs(a.price - entry);

    const distanceB =
      Math.abs(b.price - entry);

    /*
     * Primary objective is the nearest valid
     * directional objective.
     */
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    /*
     * Prefer liquidity when distances match.
     */
    if (
      a.source !== b.source
    ) {
      return (
        a.source === "liquidity"
          ? -1
          : 1
      );
    }

    /*
     * Stable ordering.
     */
    return (
      direction === "LONG"
        ? a.price - b.price
        : b.price - a.price
    );
  });
}

function selectTargets(
  candidates,
  entry,
  stop,
  direction
) {
  const valid = candidates
    .map((candidate) => ({
      ...candidate,
      riskReward:
        calculateRR(
          entry,
          stop,
          candidate.price,
          direction
        ),
    }))
    .filter(
      (candidate) =>
        candidate.riskReward !== null
    );

  /*
   * The market must provide a genuine 2R
   * primary objective.
   *
   * We do NOT promote a weak target simply
   * because no better target exists.
   */
  const primary =
    valid.find(
      (candidate) =>
        candidate.riskReward >= MIN_RR
    ) || null;

  if (!primary) {
    return {
      valid: false,
      targets: valid.slice(0, MAX_TARGETS),
      riskReward:
        valid[0]?.riskReward ?? null,
      reason:
        valid.length === 0
          ? "No valid directional target exists"
          : `No directional liquidity objective provides at least ${MIN_RR}R`,
    };
  }

  /*
   * Once a valid primary target exists,
   * include progressively further objectives.
   */
  const ordered = valid
    .filter(
      (candidate) =>
        direction === "LONG"
          ? candidate.price >= primary.price
          : candidate.price <= primary.price
    )
    .sort((a, b) =>
      direction === "LONG"
        ? a.price - b.price
        : b.price - a.price
    );

  const selected = ordered
    .slice(0, MAX_TARGETS)
    .map((candidate, index) => ({
      index: index + 1,
      price: candidate.price,
      timeframe: candidate.timeframe,
      type: candidate.type,
      side: candidate.side,
      riskReward: candidate.riskReward,
    }));

  return {
    valid: true,
    targets: selected,
    riskReward: selected[0].riskReward,
    reason:
      "Directional liquidity objective provides acceptable risk/reward",
  };
}

function buildTargets({
  entry,
  stop,
  direction,
  liquidity,
  structures,
}) {
  if (!finite(entry)) {
    return {
      valid: false,
      targets: [],
      riskReward: null,
      reason: "Invalid entry price",
    };
  }

  if (!finite(stop)) {
    return {
      valid: false,
      targets: [],
      riskReward: null,
      reason: "Invalid stop price",
    };
  }

  if (
    direction !== "LONG" &&
    direction !== "SHORT"
  ) {
    return {
      valid: false,
      targets: [],
      riskReward: null,
      reason: "Invalid trade direction",
    };
  }

  const risk =
    direction === "LONG"
      ? entry - stop
      : stop - entry;

  if (risk <= 0) {
    return {
      valid: false,
      targets: [],
      riskReward: null,
      reason:
        "Stop is invalid for trade direction",
    };
  }

  const liquidityCandidates =
    collectLiquidityCandidates(
      liquidity,
      direction,
      entry
    );

  const structureCandidates =
    collectStructureCandidates(
      structures,
      direction,
      entry
    );

  const candidates =
    deduplicateCandidates([
      ...liquidityCandidates,
      ...structureCandidates,
    ]);

  sortDirectionalCandidates(
    candidates,
    direction,
    entry
  );

  return selectTargets(
    candidates,
    entry,
    stop,
    direction
  );
}

module.exports = {
  MIN_RR,
  MAX_TARGETS,
  buildTargets,
};
