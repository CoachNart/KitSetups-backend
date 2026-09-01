"use strict";

/*
 * KITSETUPS — CANONICAL TRADING SERVICE
 *
 * Application/service layer → new trading architecture.
 *
 * The service contains NO trading logic.
 * It delegates exclusively to src/trading/engine.js.
 */

const {
  analyzeSymbol,
} = require("../trading/engine");

async function analyzeTradingMarket(symbol = "BTCUSDT") {
  return analyzeSymbol(symbol);
}

module.exports = {
  analyzeTradingMarket,
};
