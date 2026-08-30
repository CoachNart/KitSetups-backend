const { userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");
const { analyzeTradingMarket } = require("../services/tradingEngine");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin":
      process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function analysisRoutes(req, res) {
  if (
    req.method !== "GET" ||
    !req.url.startsWith("/api/analysis")
  ) {
    return false;
  }

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;

    const snap =
      await userRef(uid).get();

    if (!snap.exists) {
      return json(res, 404, {
        ok: false,
        error: "Account not found",
        code: "ACCOUNT_NOT_FOUND",
      });
    }

    const access =
      getAccessState(snap.data());

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

    const url = new URL(
      req.url,
      "http://localhost",
    );

    const symbol =
      url.searchParams.get("symbol") ||
      "BTCUSDT";

    const analysis =
      await analyzeTradingMarket(symbol);

    return json(res, 200, {
      ok: true,

      data: {
        ...analysis,
        access,
        subscribeRequired: false,
      },
    });
  });
}

module.exports = {
  analysisRoutes,
};
