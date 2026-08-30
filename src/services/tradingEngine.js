const { analyzeMarket } = require("../tools/marketEngine");

async function analyzeTradingMarket(symbol = "BTCUSDT") {
  return analyzeMarket(symbol);
}

module.exports = {
  analyzeTradingMarket,
};
