const { userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");
const { analyzeTradingMarket } = require("../services/tradingEngine");
const { fetchTicker } = require("../trading/data/marketData");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

function fallbackAnalysis(symbol, price = null, access = null) {
  return {
    symbol,
    price: Number.isFinite(Number(price)) ? Number(price) : null,
    status: "WAIT",
    valid: false,
    direction: null,
    entry: null,
    stop: null,
    targets: [],
    riskReward: null,
    quality: {
      score: 0,
      grade: "WATCH",
    },
    stage: "market-data",
    reason: "Live market data is available, but full technical analysis is temporarily unavailable.",
    source: "bybit-fallback",
    access,
    subscribeRequired: !access?.hasAccess,
  };
}

async function analysisRoutes(req, res) {
  if (req.method !== "GET" || !req.url.startsWith("/api/analysis")) {
    return false;
  }

  return requireAuth(req, res, async () => {
    const url = new URL(req.url, "http://localhost");
    const symbol = url.searchParams.get("symbol") || "BTCUSDT";

    let account = null;
    let access = {
      hasAccess: false,
      accessLocked: true,
      status: "ACCOUNT_UNAVAILABLE",
      plan: "free",
      expiresAt: null,
    };

    try {
      const uid = req.user.uid;
      const snap = await userRef(uid).get();

      if (snap.exists) {
        account = snap.data();
        access = getAccessState(account);
      } else {
        access = getAccessState(null);
      }
    } catch (error) {
      console.warn("⚠️ Analysis account lookup unavailable; using locked fallback:", error.message || error);
    }

    if (!access.hasAccess) {
      return json(res, 403, {
        ok: false,
        error: "Active subscription required",
        code: "ACCESS_EXPIRED",
        data: {
          analysis: null,
          access,
          subscribeRequired: true,
        },
      });
    }

    try {
      const analysis = await analyzeTradingMarket(symbol);

      return json(res, 200, {
        ok: true,
        data: {
          ...analysis,
          access,
          subscribeRequired: false,
        },
      });
    } catch (error) {
      console.error("⚠️ Full market analysis unavailable:", error.stack || error.message || error);

      let price = null;
      try {
        const ticker = await fetchTicker(symbol);
        price = Number(ticker?.lastPrice);
      } catch (tickerError) {
        console.warn("⚠️ Analysis fallback ticker unavailable:", tickerError.message || tickerError);
      }

      return json(res, 200, {
        ok: true,
        data: {
          analysis: fallbackAnalysis(symbol, price, access),
          access,
          subscribeRequired: false,
          degraded: true,
        },
      });
    }
  });
}

module.exports = {
  analysisRoutes,
};
