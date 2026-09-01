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


module.exports = {
  scanSymbol,
};
