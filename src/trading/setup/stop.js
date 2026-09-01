"use strict";

/*
 * ============================================================
 * KITSETUPS — STOP ENGINE
 * ============================================================
 *
 * Purpose:
 * Determine the structural invalidation level of a setup.
 *
 * Rules:
 * - Stop is based on market structure.
 * - LONG stops sit below meaningful structural lows.
 * - SHORT stops sit above meaningful structural highs.
 * - The engine never invents a stop from a desired RR.
 * - If structure does not provide a defensible invalidation
 *   level, the setup is rejected.
 *
 * Timeframe hierarchy:
 *   1H = trade structure
 *   30M = execution structure
 *
 * 30M gives the precise invalidation.
 * 1H provides the higher-level fallback.
 * ============================================================
 */

const TIMEFRAMES = Object.freeze({
  TRADE: "1h",
  EXECUTION: "30m",
});

const MIN_STOP_DISTANCE = 0.0010; // 0.10%
const STOP_BUFFER = 0.0005;       // 0.05%

function finite(value) {
  return Number.isFinite(Number(value));
}

function priceOf(point) {
  if (finite(point)) {
    return Number(point);
  }

  if (finite(point?.price)) {
    return Number(point.price);
  }

  return null;
}

function getLatestStructuralLow(structure) {
  return priceOf(
    structure?.latest?.low ??
    structure?.swings?.lows?.at?.(-1)
  );
}

function getLatestStructuralHigh(structure) {
  return priceOf(
    structure?.latest?.high ??
    structure?.swings?.highs?.at?.(-1)
  );
}

function buildLongStop(entry, executionStructure, tradeStructure) {
  const executionLow =
    getLatestStructuralLow(executionStructure);

  const tradeLow =
    getLatestStructuralLow(tradeStructure);

  /*
   * Prefer execution invalidation when it gives
   * sufficient structural room.
   */
  const candidates = [
    {
      price: executionLow,
      timeframe: TIMEFRAMES.EXECUTION,
    },
    {
      price: tradeLow,
      timeframe: TIMEFRAMES.TRADE,
    },
  ].filter((item) => finite(item.price));

  for (const candidate of candidates) {
    const stop =
      candidate.price * (1 - STOP_BUFFER);

    const distance =
      (entry - stop) / entry;

    if (stop < entry && distance >= MIN_STOP_DISTANCE) {
      return {
        valid: true,
        direction: "LONG",
        stop,
        reference: {
          timeframe: candidate.timeframe,
          structuralLevel: candidate.price,
        },
        distancePercent: distance * 100,
        reason:
          `LONG stop below ${candidate.timeframe} structural low`,
      };
    }
  }

  return {
    valid: false,
    direction: "LONG",
    stop: null,
    reason:
      "No defensible LONG structural invalidation level",
  };
}

function buildShortStop(entry, executionStructure, tradeStructure) {
  const executionHigh =
    getLatestStructuralHigh(executionStructure);

  const tradeHigh =
    getLatestStructuralHigh(tradeStructure);

  const candidates = [
    {
      price: executionHigh,
      timeframe: TIMEFRAMES.EXECUTION,
    },
    {
      price: tradeHigh,
      timeframe: TIMEFRAMES.TRADE,
    },
  ].filter((item) => finite(item.price));

  for (const candidate of candidates) {
    const stop =
      candidate.price * (1 + STOP_BUFFER);

    const distance =
      (stop - entry) / entry;

    if (stop > entry && distance >= MIN_STOP_DISTANCE) {
      return {
        valid: true,
        direction: "SHORT",
        stop,
        reference: {
          timeframe: candidate.timeframe,
          structuralLevel: candidate.price,
        },
        distancePercent: distance * 100,
        reason:
          `SHORT stop above ${candidate.timeframe} structural high`,
      };
    }
  }

  return {
    valid: false,
    direction: "SHORT",
    stop: null,
    reason:
      "No defensible SHORT structural invalidation level",
  };
}

function calculateStop({
  direction,
  entry,
  structures,
}) {
  if (!finite(entry)) {
    throw new Error("Valid entry price is required");
  }

  if (!structures) {
    throw new Error("Structure analysis is required");
  }

  const executionStructure =
    structures[TIMEFRAMES.EXECUTION];

  const tradeStructure =
    structures[TIMEFRAMES.TRADE];

  if (
    direction !== "LONG" &&
    direction !== "SHORT"
  ) {
    return {
      valid: false,
      stop: null,
      reason: "Direction must be LONG or SHORT",
    };
  }

  const result =
    direction === "LONG"
      ? buildLongStop(
          Number(entry),
          executionStructure,
          tradeStructure
        )
      : buildShortStop(
          Number(entry),
          executionStructure,
          tradeStructure
        );

  if (result.valid) {
    result.stop =
      Number(result.stop.toFixed(8));
  }

  return result;
}

module.exports = {
  TIMEFRAMES,
  calculateStop,
};
