"use strict";

/*
 * ============================================================
 * KITSETUPS — CLEAN SCANNER
 * ============================================================
 *
 * Universe
 *    ↓
 * Trading Engine
 *    ↓
 * Snapshot
 *
 * The scanner does not contain trading rules.
 * ============================================================
 */

const {
  getUniverse,
} = require("./universe");

const {
  createSnapshot,
} = require("./snapshot");

const {
  analyzeSymbol,
} = require("../trading/engine");

async function scanSymbol(symbol) {
  if (!symbol) {
    throw new Error(
      "symbol is required"
    );
  }

  const result =
    await analyzeSymbol(symbol);

  return createSnapshot(result);
}

async function scanUniverse(
  symbols = getUniverse()
) {
  if (!Array.isArray(symbols)) {
    throw new Error(
      "symbols must be an array"
    );
  }

  const snapshots = [];

  for (const symbol of symbols) {
    try {
      const snapshot =
        await scanSymbol(symbol);

      snapshots.push(snapshot);
    } catch (error) {
      snapshots.push({
        symbol,
        status: "ERROR",
        valid: false,
        stage: "scanner",
        reason:
          error.message ||
          "Scan failed",
        generatedAt:
          new Date().toISOString(),
      });
    }
  }

  return snapshots;
}

module.exports = {
  scanSymbol,
  scanUniverse,
};
