"use strict";

/*
 * KITSETUPS — TRADING UNIVERSE
 *
 * Defines the set of symbols to scan.
 *
 * Can be:
 * - Static list (this file)
 * - Dynamic from Firestore
 * - Dynamic from Bybit API
 */

const UNIVERSE_STATIC = Object.freeze([
  // Major pairs
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "MATICUSDT",
  "AVAXUSDT",
  "FTMUSDT",
  "LINKUSDT",
  "UNIUSDT",
  "ARBITUSDT",
  "OPUSDT",
  "INJUSDT",
]);

async function getUniverse() {
  // TODO: Implement dynamic universe loading from Firestore or API
  // For now, return static list
  return UNIVERSE_STATIC;
}

module.exports = {
  UNIVERSE_STATIC,
  getUniverse,
};
