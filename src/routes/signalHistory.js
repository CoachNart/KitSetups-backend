const { db, userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");

const SIGNALS_COLLECTION = "signals";

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function signalHistoryRoutes(req, res) {
  if (
    req.method !== "GET" ||
    !req.url.startsWith("/api/signals/history")
  ) {
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

      const account = accountSnap.data() || {};
      const access = getAccessState(account);

      const snapshot = await db
        .collection(SIGNALS_COLLECTION)
        .where("published", "==", true)
        .orderBy("publishedAt", "desc")
        .limit(100)
        .get();

      const signals = snapshot.docs.map((doc) => {
        const signal = {
          ...doc.data(),
          signalId: doc.data()?.signalId || doc.id,
        };

        if (!access.hasAccess) {
          delete signal.entry;
          delete signal.stop;
          delete signal.target;
          delete signal.entryZone;
          delete signal.reason;

          if (signal.tradePlan) {
            signal.tradePlan = { ...signal.tradePlan };
            delete signal.tradePlan.entry;
            delete signal.tradePlan.stop;
            delete signal.tradePlan.target;
            delete signal.tradePlan.entryZone;
            delete signal.tradePlan.reason;
          }

          if (signal.lifecycle) {
            signal.lifecycle = { ...signal.lifecycle };

            if (Array.isArray(signal.lifecycle.targets)) {
              signal.lifecycle.targets =
                signal.lifecycle.targets.map((target) => {
                  const safeTarget = { ...target };
                  delete safeTarget.price;
                  return safeTarget;
                });
            }
          }
        }

        return signal;
      });

      return json(res, 200, {
        ok: true,
        data: {
          signals,
          count: signals.length,
          access,
        },
      });
    } catch (error) {
      console.error(
        "❌ Signal history route failed:",
        error.stack || error.message || error,
      );

      return json(res, 500, {
        ok: false,
        error: "Failed to load signal history",
        code: "SIGNAL_HISTORY_FETCH_FAILED",
      });
    }
  });
}

module.exports = {
  signalHistoryRoutes,
};
