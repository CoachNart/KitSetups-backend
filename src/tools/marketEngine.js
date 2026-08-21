const market = require("./market");
const analysis = require("./analysis");
const structure = require("./structure");
const alignment = require("./alignment");
const tradePlan = require("./tradePlan");

async function analyzeMarket(symbol = "BTCUSDT") {
  const snapshot =
    await market.getMarketSnapshot(symbol);

  const analyzed =
    analysis.buildMarketAnalysis(snapshot);

  const structures = {};

  for (const timeframe of [
    "1w",
    "1d",
    "4h",
    "1h",
    "30m",
    "15m",
  ]) {
    structures[timeframe] =
      structure.analyzeStructure(
        snapshot.timeframes[timeframe].candles
      );

    if (analyzed.timeframes?.[timeframe]) {
      analyzed.timeframes[timeframe].structure =
        structures[timeframe];
    }
  }

  const alignmentResult =
    alignment.analyzeAlignment(structures);

  const enrichedSnapshot = {
    ...analyzed,

    currentPrice:
      snapshot.ticker.lastPrice,

    alignment:
      alignmentResult
  };

  const plan =
    tradePlan.buildTradePlan(
      enrichedSnapshot
    );

  return {
    symbol,

    price:
      snapshot.ticker.lastPrice,

    market:
      analyzed.market,

    structures,

    alignment:
      alignmentResult,

    tradePlan:
      plan,

    generatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  analyzeMarket
};
