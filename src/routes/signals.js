const { userRef, db } = require("../services/firestore");

const { requireAuth } = require("../middleware/auth");

const { getAccessState } = require("../services/access");
const { fetchTicker } = require("../trading/data/marketData");

const SIGNALS_COLLECTION = "signals";

const SIGNALS_DOCUMENT = "latest";

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",

    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",

    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",

    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function signalsRoutes(req, res) {
  if (req.method !== "GET" || !req.url.startsWith("/api/signals")) {
    return false;
  }

  return requireAuth(req, res, async () => {
    try {
      const uid = req.user.uid;

      const accountSnap = await userRef(uid).get();

      if (!accountSnap.exists) {
        return json(res, 404, {
          ok: false,

          error: "Account not found",

          code: "ACCOUNT_NOT_FOUND",
        });
      }

      const account = accountSnap.data();

      const access = getAccessState(account);

      /*
       * ACCESS MODEL
       *
       * Expired trial/premium users still receive a safe
       * preview of published signals.
       *
       * Execution data is removed server-side so it cannot
       * be recovered from the browser/API response.
       */

      /*
       * FRONTEND DATA SOURCE
       *
       * The API no longer runs the market
       * intelligence engine.
       *
       * It reads the scanner's canonical
       * Firestore snapshot.
       */
      const snapshot = await db
        .collection(SIGNALS_COLLECTION)
        .doc(SIGNALS_DOCUMENT)
        .get();

      if (!snapshot.exists) {
        return json(res, 503, {
          ok: false,

          error: "Market scanner has not published a snapshot yet",

          code: "SCANNER_SNAPSHOT_UNAVAILABLE",

          data: {
            signals: [],
            setups: {},
            access,

            subscribeRequired: false,
          },
        });
      }

      const scannerData = snapshot.data() || {};

      /*
       * EXPIRED ACCESS PREVIEW
       *
       * Keep signal metadata available for the frontend
       * while protecting execution levels.
       */
      let responseSignals = Array.isArray(scannerData.signals)
        ? scannerData.signals
        : [];

      /*
       * LIVE MARKET PRICE
       *
       * Scanner snapshots contain the price captured during the
       * last scan cycle. That price must NOT be treated as the
       * current market price.
       *
       * Refresh the market price from the live ticker whenever
       * the frontend requests signals.
       *
       * Setup levels (entry / stop / targets) remain unchanged.
       */
      responseSignals = await Promise.all(
        responseSignals.map(async (signal) => {
          try {
            const ticker = await fetchTicker(signal.symbol);

            if (
              Number.isFinite(ticker?.lastPrice) &&
              ticker.lastPrice > 0
            ) {
              return {
                ...signal,
                price: ticker.lastPrice,
              };
            }
          } catch (error) {
            console.warn(
              `⚠️ Live price refresh failed for ${signal.symbol}:`,
              error.message || error,
            );
          }

          return signal;
        }),
      );

      if (!access.hasAccess) {
        responseSignals = responseSignals.map((signal) => {
          const safeSignal = { ...signal };

          delete safeSignal.entry;
          delete safeSignal.stop;
          delete safeSignal.target;
          delete safeSignal.entryZone;
          delete safeSignal.reason;

          /*
           * Preserve lifecycle state for locked previews,
           * but never expose target execution prices.
           */
          if (safeSignal.lifecycle) {
            safeSignal.lifecycle = { ...safeSignal.lifecycle };

            if (Array.isArray(safeSignal.lifecycle.targets)) {
              safeSignal.lifecycle.targets = safeSignal.lifecycle.targets.map(
                (target) => {
                  const safeTarget = { ...target };
                  delete safeTarget.price;
                  return safeTarget;
                },
              );
            }
          }

          return safeSignal;
        });
      }

      /*
       * signals/latest is the compact frontend index.
       *
       * Preserve the scanner payload without
       * reconstructing or discarding its fields.
       */

      return json(res, 200, {
        ok: true,

        data: {
          ...scannerData,

          signals: responseSignals,

          access,

          subscribeRequired: !access.hasAccess,

          scanner: scannerData.scanner || null,
        },
      });
    } catch (error) {
      console.error(
        "❌ Signals route failed:",
        error.stack || error.message || error,
      );

      return json(res, 500, {
        ok: false,

        error: "Failed to load market signals",

        code: "SIGNALS_FETCH_FAILED",
      });
    }
  });
}

module.exports = {
  signalsRoutes,
};
