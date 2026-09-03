const { db, userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");
const { analyzeTradingMarket } = require("../services/tradingEngine");
const { fetchTicker } = require("../trading/data/marketData");

const MARKET_INTELLIGENCE_COLLECTION = "marketIntelligence";
const SIGNALS_COLLECTION = "signals";
const SIGNALS_DOCUMENT = "latest";

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-KitSetups-Device",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

function normalizeSymbol(value) {
  return String(value || "BTCUSDT").trim().toUpperCase();
}

function getStatus(payload) {
  return String(
    payload?.status ||
      payload?.signalState ||
      payload?.lifecycle?.status ||
      payload?.tradePlan?.status ||
      "WAIT",
  ).toUpperCase();
}

function getDirection(payload) {
  return String(
    payload?.direction || payload?.bias || payload?.setup?.direction || "",
  ).toUpperCase();
}

function buildDecision(analysis) {
  const status = getStatus(analysis);
  const valid = analysis?.valid === true || status === "READY" || status === "ACTIVE";
  const score = Number(analysis?.quality?.score ?? analysis?.score ?? 0);

  let reason = analysis?.reason || analysis?.reasons?.[0] || null;

  if (!reason && valid) {
    reason = Array.isArray(analysis?.reasons)
      ? analysis.reasons.join("; ")
      : "Setup passed the current trading-engine validation gates.";
  }

  return {
    status: valid ? (status === "READY" ? "VALID" : status) : status,
    valid,
    score: Number.isFinite(score) ? score : 0,
    reason,
  };
}

function toAnalysisResponse(raw, access = null, options = {}) {
  const source = raw?.analysis || raw || {};
  const context = source?.evidence?.context || source?.context || null;
  const structures = source?.evidence?.structures || source?.structures || null;
  const liquidity = source?.evidence?.liquidity || source?.liquidity || null;
  const momentum = source?.evidence?.momentum || source?.momentum || null;
  const setup = source?.evidence?.setup || source?.setup || null;
  const entry = source?.evidence?.entry || source?.entry || null;
  const stop = source?.evidence?.stop || source?.stop || null;
  const targets = source?.evidence?.targets || source?.targets || null;

  const price = Number(source?.price);
  const quality = source?.quality || {};
  const rr = Number(source?.riskReward ?? targets?.riskReward);

  return {
    symbol: normalizeSymbol(source?.symbol),
    timeframe: source?.timeframe || "multi-timeframe",
    timestamp:
      source?.generatedAt || source?.updatedAt || new Date().toISOString(),
    market: {
      price: Number.isFinite(price) ? price : null,
      trend:
        context?.bias ||
        source?.trend ||
        source?.market?.trend ||
        null,
      regime: source?.regime || source?.market?.regime || null,
      volatility: source?.market?.volatility || null,
      change24hPercent: Number(source?.ticker?.change24hPercent),
      volume24h: Number(source?.ticker?.volume24h),
    },
    technical: {
      context,
      structure: structures,
      momentum,
      liquidity,
    },
    levels: {
      support: source?.levels?.support || [],
      resistance: source?.levels?.resistance || [],
      entryZone:
        source?.entryZone ||
        (entry?.price != null ? [entry.price, entry.price] : []),
      entry: entry?.price ?? source?.entry ?? null,
      invalidation: stop?.stop ?? source?.stop ?? source?.invalidation ?? null,
      stop: stop?.stop ?? source?.stop ?? null,
      targets: targets?.targets || source?.targets || [],
    },
    setup: {
      direction: getDirection(source) || null,
      confidence: Number(quality?.score ?? source?.confidence ?? 0),
      score: Number(quality?.score ?? source?.score ?? 0),
      grade: quality?.grade || null,
      riskReward: Number.isFinite(rr) ? rr : null,
      detection: setup,
    },
    confluence: Array.isArray(quality?.components)
      ? quality.components
      : quality?.components
        ? Object.entries(quality.components).map(([factor, weight]) => ({
            factor,
            signal: null,
            weight,
          }))
        : [],
    risk: {
      riskLevel: source?.risk?.riskLevel || null,
      invalidation: stop?.stop ?? source?.stop ?? source?.invalidation ?? null,
      warnings: source?.risk?.warnings || [],
    },
    decision: buildDecision(source),
    evidence: {
      context,
      structures,
      liquidity,
      momentum,
      setup,
      entry,
      stop,
      targets,
    },
    lifecycle: source?.lifecycle || null,
    reasons: Array.isArray(source?.reasons) ? source.reasons : [],
    generatedAt: source?.generatedAt || null,
    source: options.source || "kitsetups-trading-engine",
    access,
    subscribeRequired: Boolean(options.subscribeRequired),
    degraded: Boolean(options.degraded),
  };
}

function stripPremiumFields(analysis, access) {
  const safe = JSON.parse(JSON.stringify(analysis));

  delete safe.levels.entry;
  delete safe.levels.entryZone;
  delete safe.levels.stop;
  delete safe.levels.invalidation;
  delete safe.levels.targets;
  delete safe.setup.riskReward;
  delete safe.risk.invalidation;

  if (safe.lifecycle?.targets) {
    safe.lifecycle.targets = safe.lifecycle.targets.map((target) => {
      const copy = { ...target };
      delete copy.price;
      return copy;
    });
  }

  safe.access = access;
  safe.subscribeRequired = true;
  safe.degraded = true;
  return safe;
}

function fallbackAnalysis(symbol, price = null, access = null) {
  return {
    symbol: normalizeSymbol(symbol),
    timeframe: "multi-timeframe",
    timestamp: new Date().toISOString(),
    market: {
      price: Number.isFinite(Number(price)) ? Number(price) : null,
      trend: null,
      regime: null,
      volatility: null,
      change24hPercent: null,
      volume24h: null,
    },
    technical: {
      context: null,
      structure: null,
      momentum: null,
      liquidity: null,
    },
    levels: {
      support: [],
      resistance: [],
      entryZone: [],
      entry: null,
      invalidation: null,
      stop: null,
      targets: [],
    },
    setup: {
      direction: null,
      confidence: 0,
      score: 0,
      grade: "WATCH",
      riskReward: null,
      detection: null,
    },
    confluence: [],
    risk: {
      riskLevel: null,
      invalidation: null,
      warnings: ["Full technical analysis is temporarily unavailable."],
    },
    decision: {
      status: "WAIT",
      valid: false,
      score: 0,
      reason:
        "Live market data is available, but full technical analysis is temporarily unavailable.",
    },
    evidence: {},
    lifecycle: null,
    reasons: [],
    generatedAt: new Date().toISOString(),
    source: "bybit-fallback",
    access,
    subscribeRequired: !access?.hasAccess,
    degraded: true,
  };
}

async function getAccess(req) {
  let access = {
    hasAccess: false,
    accessLocked: true,
    status: "ACCOUNT_UNAVAILABLE",
    plan: "free",
    expiresAt: null,
  };

  try {
    const snap = await userRef(req.user.uid).get();
    access = getAccessState(snap.exists ? snap.data() : null);
  } catch (error) {
    console.warn(
      "⚠️ Analysis account lookup unavailable:",
      error.message || error,
    );
  }

  return access;
}

async function getLivePrice(symbol) {
  try {
    const ticker = await fetchTicker(symbol);
    const price = Number(ticker?.lastPrice);
    return Number.isFinite(price) ? price : null;
  } catch (error) {
    console.warn("⚠️ Analysis ticker unavailable:", error.message || error);
    return null;
  }
}

async function loadStoredAnalysis(symbol) {
  const doc = await db.collection(MARKET_INTELLIGENCE_COLLECTION).doc(symbol).get();
  return doc.exists ? doc.data() : null;
}

async function loadSignal(signalId) {
  const doc = await db.collection(SIGNALS_COLLECTION).doc(signalId).get();
  return doc.exists ? { ...doc.data(), signalId: doc.data()?.signalId || doc.id } : null;
}

async function loadLatestSignals() {
  const snapshot = await db.collection(SIGNALS_COLLECTION).doc(SIGNALS_DOCUMENT).get();
  if (!snapshot.exists) return null;
  return snapshot.data();
}

async function loadMarketOverview() {
  const snapshot = await db.collection(MARKET_INTELLIGENCE_COLLECTION).get();

  return snapshot.docs
    .map((doc) => {
      const item = doc.data() || {};
      const quality = item.quality || {};
      const context = item.evidence?.context || item.context || {};

      return {
        symbol: normalizeSymbol(item.symbol || doc.id),
        price: Number(item.price),
        trend: context.bias || item.trend || null,
        regime: item.regime || null,
        status: getStatus(item),
        direction: getDirection(item) || null,
        score: Number(quality.score || 0),
        grade: quality.grade || null,
        riskReward: Number(item.riskReward || 0) || null,
        generatedAt: item.generatedAt || null,
      };
    })
    .filter((item) => item.symbol)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function analysisRoutes(req, res) {
  if (req.method !== "GET" || !req.url.startsWith("/api/analysis")) {
    return false;
  }

  return requireAuth(req, res, async () => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "");
    const access = await getAccess(req);

    try {
      // GET /api/analysis/overview
      if (pathname === "/api/analysis/overview") {
        const markets = await loadMarketOverview();
        const snapshot = await loadLatestSignals();

        return json(res, 200, {
          ok: true,
          data: {
            generatedAt: snapshot?.generatedAt || new Date().toISOString(),
            regime: snapshot?.regime || null,
            market: snapshot?.market || null,
            markets,
            signals: snapshot?.signals || [],
            access,
          },
        });
      }

      // GET /api/analysis/market
      if (pathname === "/api/analysis/market") {
        const symbol = normalizeSymbol(url.searchParams.get("symbol") || "BTCUSDT");
        const stored = await loadStoredAnalysis(symbol);
        const price = Number(stored?.price);

        if (stored) {
          const analysis = toAnalysisResponse(stored, access, {
            source: "marketIntelligence",
          });
          return json(res, 200, { ok: true, data: { analysis, access } });
        }

        const livePrice = Number.isFinite(price) ? price : await getLivePrice(symbol);
        const analysis = fallbackAnalysis(symbol, livePrice, access);
        return json(res, 200, { ok: true, data: { analysis, access } });
      }

      // GET /api/analysis/setups/:id
      const setupMatch = pathname.match(/^\/api\/analysis\/setups\/([^/]+)$/);
      if (setupMatch) {
        const signal = await loadSignal(decodeURIComponent(setupMatch[1]));

        if (!signal) {
          return json(res, 404, {
            ok: false,
            error: "Setup analysis not found",
            code: "ANALYSIS_SETUP_NOT_FOUND",
          });
        }

        let analysis = toAnalysisResponse(signal, access, {
          source: "signals-history",
          subscribeRequired: !access.hasAccess,
        });

        if (!access.hasAccess) {
          analysis = stripPremiumFields(analysis, access);
        }

        return json(res, 200, {
          ok: true,
          data: {
            analysis,
            setup: signal,
            access,
            subscribeRequired: !access.hasAccess,
          },
        });
      }

      // GET /api/analysis/symbols/:symbol
      const symbolMatch = pathname.match(/^\/api\/analysis\/symbols\/([^/]+)$/);
      if (symbolMatch) {
        const symbol = normalizeSymbol(decodeURIComponent(symbolMatch[1]));

        if (!access.hasAccess) {
          const price = await getLivePrice(symbol);
          const analysis = fallbackAnalysis(symbol, price, access);
          return json(res, 200, {
            ok: true,
            data: {
              analysis,
              access,
              subscribeRequired: true,
              degraded: true,
            },
          });
        }

        try {
          const raw = await analyzeTradingMarket(symbol);
          const analysis = toAnalysisResponse(raw, access, {
            source: "live-trading-engine",
          });

          return json(res, 200, {
            ok: true,
            data: {
              analysis,
              access,
              subscribeRequired: false,
              degraded: false,
            },
          });
        } catch (error) {
          console.error(
            "⚠️ Full symbol analysis unavailable:",
            error.stack || error.message || error,
          );

          const price = await getLivePrice(symbol);
          const analysis = fallbackAnalysis(symbol, price, access);

          return json(res, 200, {
            ok: true,
            data: { analysis, access, subscribeRequired: false, degraded: true },
          });
        }
      }

      // Backward-compatible GET /api/analysis?symbol=BTCUSDT
      if (pathname === "/api/analysis") {
        const symbol = normalizeSymbol(url.searchParams.get("symbol") || "BTCUSDT");

        if (!access.hasAccess) {
          const price = await getLivePrice(symbol);
          const analysis = fallbackAnalysis(symbol, price, access);
          return json(res, 200, {
            ok: true,
            data: { analysis, access, subscribeRequired: true, degraded: true },
          });
        }

        try {
          const raw = await analyzeTradingMarket(symbol);
          const analysis = toAnalysisResponse(raw, access, {
            source: "live-trading-engine",
          });
          return json(res, 200, {
            ok: true,
            data: { analysis, access, subscribeRequired: false, degraded: false },
          });
        } catch (error) {
          console.error(
            "⚠️ Full market analysis unavailable:",
            error.stack || error.message || error,
          );

          const price = await getLivePrice(symbol);
          const analysis = fallbackAnalysis(symbol, price, access);
          return json(res, 200, {
            ok: true,
            data: { analysis, access, subscribeRequired: false, degraded: true },
          });
        }
      }

      return json(res, 404, {
        ok: false,
        error: "Analysis route not found",
        code: "ANALYSIS_ROUTE_NOT_FOUND",
      });
    } catch (error) {
      console.error(
        "❌ Analysis route failed:",
        error.stack || error.message || error,
      );

      return json(res, 500, {
        ok: false,
        error: "Failed to load analysis",
        code: "ANALYSIS_FETCH_FAILED",
      });
    }
  });
}

module.exports = {
  analysisRoutes,
};
