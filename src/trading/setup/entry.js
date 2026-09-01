"use strict";

/*
 * KITSETUPS — ENTRY ENGINE
 *
 * Converts a detected directional setup into an executable
 * entry price.
 *
 * This module does NOT:
 *   - decide market direction
 *   - create signals
 *   - calculate stops
 *   - calculate targets
 *   - calculate R:R
 *
 * It only answers:
 *
 *   "Where should this setup be entered?"
 */

function finite(value) {
  return Number.isFinite(Number(value));
}

function priceOf(value) {
  if (finite(value)) {
    return Number(value);
  }

  if (finite(value?.price)) {
    return Number(value.price);
  }

  return null;
}

function latestStructure(structure) {
  if (!structure) {
    return null;
  }

  return {
    high: priceOf(structure.latest?.high),
    low: priceOf(structure.latest?.low),
  };
}

function getRecentRange(structure) {
  const latest = latestStructure(structure);

  if (
    !latest ||
    !finite(latest.high) ||
    !finite(latest.low) ||
    latest.high <= latest.low
  ) {
    return null;
  }

  return latest;
}

function chooseLongEntry({
  price,
  tradeStructure,
  executionStructure,
}) {
  const tradeRange =
    getRecentRange(tradeStructure);

  const executionRange =
    getRecentRange(executionStructure);

  /*
   * Prefer the 30M structure because it is the execution
   * timeframe. Fall back to 1H only when 30M does not
   * provide usable structure.
   */
  const range =
    executionRange ||
    tradeRange;

  if (!range) {
    return {
      valid: false,
      reason: "No usable bullish entry structure",
    };
  }

  /*
   * For a long setup, the latest structural low provides
   * the most meaningful retracement reference.
   *
   * We do not blindly enter at the current price if price
   * has already moved beyond the structure.
   */
  const structuralLow = range.low;

  if (!finite(price)) {
    return {
      valid: false,
      reason: "Invalid market price",
    };
  }

  /*
   * The entry is the current executable price when price is
   * still inside/near the active structure.
   *
   * A price substantially above the latest structural high
   * means the move is already extended and should not be
   * chased by this module.
   */
  if (price > range.high) {
    return {
      valid: false,
      reason: "LONG price is extended above execution structure",
    };
  }

  if (price <= structuralLow) {
    return {
      valid: false,
      reason: "LONG price has lost the structural entry area",
    };
  }

  return {
    valid: true,
    price: Number(price),
    reference: {
      timeframe:
        executionRange
          ? "30m"
          : "1h",
      structuralLow,
      structuralHigh: range.high,
    },
    reason:
      "LONG entry remains within executable structure",
  };
}

function chooseShortEntry({
  price,
  tradeStructure,
  executionStructure,
}) {
  const tradeRange =
    getRecentRange(tradeStructure);

  const executionRange =
    getRecentRange(executionStructure);

  const range =
    executionRange ||
    tradeRange;

  if (!range) {
    return {
      valid: false,
      reason: "No usable bearish entry structure",
    };
  }

  if (!finite(price)) {
    return {
      valid: false,
      reason: "Invalid market price",
    };
  }

  const structuralHigh =
    range.high;

  /*
   * Do not chase a bearish move that has already broken
   * materially below its execution structure.
   */
  if (price < range.low) {
    return {
      valid: false,
      reason: "SHORT price is extended below execution structure",
    };
  }

  if (price >= structuralHigh) {
    return {
      valid: false,
      reason: "SHORT price has lost the structural entry area",
    };
  }

  return {
    valid: true,
    price: Number(price),
    reference: {
      timeframe:
        executionRange
          ? "30m"
          : "1h",
      structuralHigh,
      structuralLow: range.low,
    },
    reason:
      "SHORT entry remains within executable structure",
  };
}

function calculateEntry({
  direction,
  price,
  structures,
}) {
  if (!direction) {
    return {
      valid: false,
      reason: "Direction is required",
    };
  }

  if (!finite(price)) {
    return {
      valid: false,
      reason: "Valid market price is required",
    };
  }

  if (direction === "LONG") {
    return chooseLongEntry({
      price: Number(price),
      tradeStructure:
        structures?.["1h"],
      executionStructure:
        structures?.["30m"],
    });
  }

  if (direction === "SHORT") {
    return chooseShortEntry({
      price: Number(price),
      tradeStructure:
        structures?.["1h"],
      executionStructure:
        structures?.["30m"],
    });
  }

  return {
    valid: false,
    reason: `Unsupported direction: ${direction}`,
  };
}

module.exports = {
  calculateEntry,
};
