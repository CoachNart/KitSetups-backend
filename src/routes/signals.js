const { userRef, db } = require("../services/firestore");

const { requireAuth } = require("../middleware/auth");

const { getAccessState } = require("../services/access");

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

      if (!access.hasAccess) {
        return json(res, 403, {
          ok: false,

          error: "Active subscription required",

          code: "ACCESS_EXPIRED",

          data: {
            signals: [],
            setups: {},
            access,

            subscribeRequired: true,
          },
        });
      }

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
       * signals/latest is the compact frontend index.
       *
       * Full engine intelligence lives in:
       *
       * marketIntelligence/{symbol}
       *
       * Preserve the compact scanner payload without
       * reconstructing or discarding its fields.
       */

      return json(res, 200, {
        ok: true,

        data: {
          ...scannerData,

          access,

          subscribeRequired: false,

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
