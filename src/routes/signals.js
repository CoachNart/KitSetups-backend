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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-KitSetups-Device",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function readScannerSnapshot() {
  const latest = await db
    .collection(SIGNALS_COLLECTION)
    .doc(SIGNALS_DOCUMENT)
    .get();

  if (latest.exists) {
    return latest.data() || {};
  }

  // Recovery path: older deployments can have published signal documents
  // without the aggregate `signals/latest` snapshot. Rebuild the read model
  // instead of making the entire frontend look empty.
  const published = await db
    .collection(SIGNALS_COLLECTION)
    .where("published", "==", true)
    .get();

  const signals = published.docs
    .map((doc) => ({
      ...doc.data(),
      signalId: doc.data().signalId || doc.id,
    }))
    .filter((signal) => {
      const status =
        signal.lifecycle?.status ||
        signal.signalState ||
        signal.status;

      return [
        "READY",
        "ENTRY_HIT",
        "ACTIVE",
        "TP1_HIT",
        "TP2_HIT",
        "TP3_HIT",
      ].includes(status);
    });

  return {
    signals,
    scanner: {
      status: signals.length > 0 ? "READY" : "WAITING",
      publishedSignals: signals.length,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
    recovered: true,
  };
}

async function refreshLivePrices(signals) {
  return Promise.all(
    signals.map(async (signal) => {
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
}

function protectExecutionData(signal) {
  const safeSignal = { ...signal };

  delete safeSignal.entry;
  delete safeSignal.stop;
  delete safeSignal.target;
  delete safeSignal.entryZone;
  delete safeSignal.reason;

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

      const access = getAccessState(accountSnap.data());
      const scannerData = await readScannerSnapshot();
      const rawSignals = Array.isArray(scannerData.signals)
        ? scannerData.signals
        : [];

      const responseSignals = await refreshLivePrices(rawSignals);
      const safeSignals = access.hasAccess
        ? responseSignals
        : responseSignals.map(protectExecutionData);

      return json(res, 200, {
        ok: true,
        data: {
          ...scannerData,
          signals: safeSignals,
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
