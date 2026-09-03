"use strict";

const { buildMarketRanking } = require("../services/marketRanking");

const DEFAULT_UNIVERSE = Object.freeze([
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
]);

function normalizeSymbol(symbol) {
  if (typeof symbol !== "string") return null;

  const normalized = symbol.trim().toUpperCase();

  return normalized || null;
}

async function getUniverse() {
  try {
    const ranking = await buildMarketRanking();
    const ranked = (ranking.rankedMarkets || [])
      .map((market) => normalizeSymbol(market.symbol))
      .filter(Boolean);

    if (ranked.length > 0) return ranked;
  } catch (error) {
    console.warn(
      "⚠️ Market ranking unavailable; using default scanner universe:",
      error.message || error,
    );
  }

  return [...DEFAULT_UNIVERSE];
}

function isSupportedSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  return normalized !== null;
}

function createUniverse(symbols) {
  if (!Array.isArray(symbols)) {
    throw new Error("symbols must be an array");
  }

  return [
    ...new Set(
      symbols
        .map(normalizeSymbol)
        .filter(Boolean),
    ),
  ];
}

module.exports = {
  DEFAULT_UNIVERSE,
  normalizeSymbol,
  getUniverse,
  isSupportedSymbol,
  createUniverse,
};
