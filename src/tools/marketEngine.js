const market = require("./market");
const structure = require("./structure");
const tradePlan = require("./tradePlan");
const { analyzeAlignment } = require("./alignment");

function buildAlignment(structures) {
  return analyzeAlignment(structures);
}

async function analyzeMarket(symbol = "BTCUSDT") {
  const snapshot = await market.getMarketSnapshot(symbol);

  const structures = {};

  for (const timeframe of ["1w", "1d", "4h", "1h", "30m"]) {
    const data = snapshot.timeframes?.[timeframe];

    if (!data) {
      structures[timeframe] = {
        trend: "insufficient_data",
        highPattern: null,
        lowPattern: null,
        swingHighs: [],
        swingLows: [],
        bullishBOS: false,
        bearishBOS: false,
      };

      continue;
    }

    structures[timeframe] = structure.analyzeStructure(data.candles);
  }

  /*
   * Build the same snapshot shape expected by
   * the trade engine, but attach our fresh structures.
   */
  const enrichedSnapshot = {
    ...snapshot,
    symbol,
    currentPrice: snapshot.ticker.lastPrice,

    timeframes: Object.fromEntries(
      Object.entries(snapshot.timeframes).map(([timeframe, data]) => [
        timeframe,
        {
          ...data,
          structure: structures[timeframe],
        },
      ]),
    ),
  };

  const alignment = buildAlignment(structures);

  enrichedSnapshot.alignment = alignment;

  const plan = tradePlan.buildTradePlan(enrichedSnapshot);

  return {
    symbol,

    price: snapshot.ticker.lastPrice,

    market: {
      change24hPercent: snapshot.ticker.change24hPercent,

      high24h: snapshot.ticker.high24h,

      low24h: snapshot.ticker.low24h,

      volume24h: snapshot.ticker.volume24h,

      openInterest: snapshot.ticker.openInterest,

      fundingRate: snapshot.ticker.fundingRate,
    },

    structures,

    alignment,

    weeklyContext: {
      direction: alignment.trends["1w"],
    },

    tradePlan: plan,

    /*
     * ---------------------------------------------------------
     * FRONTEND SIGNAL CONTRACT
     * ---------------------------------------------------------
     *
     * The intelligence engine owns the trade decision.
     *
     * Only a READY trade plan becomes an actionable signal.
     * WAIT / WATCH / ARMED plans remain available through
     * tradePlan and must never be promoted into signals.
     */
    signals:
      plan?.status === "READY"
        ? [
            {
              ...plan,
              symbol,
            },
          ]
        : [],

    /*
     * Preserve a stable setup container for the frontend.
     */
    setups: {
      [symbol]: plan,
    },

    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeMarket,
};
