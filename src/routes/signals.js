const { userRef, db } = require("../services/firestore");
const { getAuth } = require("firebase-admin/auth");
const { app } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");
const { fetchTicker } = require("../trading/data/marketData");
const { buildMarketRanking } = require("../services/marketRanking");
const { getLatestScanResults } = require("../scanner/runner");

const SIGNALS_COLLECTION = "signals", SIGNALS_DOCUMENT = "latest";
const LIVE_STATUSES = new Set(["READY", "ENTRY_HIT", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT"]);
const PUBLISHED_SETUP_STATUSES = new Set(["READY", "ENTRY_HIT", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT"]);
const MARKET_FALLBACK_LIMIT = 20, MARKET_FALLBACK_CACHE_MS = 60000, ACCOUNT_CACHE_TTL_MS = 60000;
let marketFallbackCache = { signals: [], generatedAt: 0 };
const accountCache = new Map();

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" });
  res.end(JSON.stringify(data));
}

function accountFromAuth(uid, reqUser, authUser) {
  const claims = authUser?.customClaims || {};
  const created = authUser?.metadata?.creationTime || null;
  const trialStartedAt = claims.kitsetupsTrialStartedAt || created;
  const trialEndsAt = claims.kitsetupsTrialEndsAt || (trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() : null);
  return { id: uid, email: authUser?.email || reqUser?.email || "", displayName: authUser?.displayName || reqUser?.name || "", photoURL: authUser?.photoURL || reqUser?.picture || null, plan: "free", planName: "Free", trialStartedAt, createdAt: created || trialStartedAt, trialEndsAt };
}

async function getAccount(uid, reqUser) {
  const cached = accountCache.get(uid);
  if (cached && Date.now() - cached.cachedAt < ACCOUNT_CACHE_TTL_MS) return cached.account;
  try {
    const snap = await userRef(uid).get();
    if (snap.exists) {
      const account = snap.data();
      accountCache.set(uid, { account, cachedAt: Date.now() });
      return account;
    }
    return null;
  } catch (error) {
    if (cached) return cached.account;
    try {
      const authUser = await getAuth(app).getUser(uid);
      return accountFromAuth(uid, reqUser, authUser);
    } catch (fallbackError) {
      console.warn("⚠️ Firebase Auth account fallback unavailable:", fallbackError.message || fallbackError);
      return null;
    }
  }
}

async function buildMarketFallback() {
  const now = Date.now();
  if (marketFallbackCache.signals.length && now - marketFallbackCache.generatedAt < MARKET_FALLBACK_CACHE_MS) return marketFallbackCache.signals;
  const ranking = await buildMarketRanking();
  const signals = (ranking.rankedMarkets || []).slice(0, MARKET_FALLBACK_LIMIT).map(m => ({ symbol: m.symbol, price: Number(m.lastPrice), status: "WAIT", valid: false, direction: null, entry: null, stop: null, targets: [], riskReward: null, quality: { score: Number(m.scores?.quality || 0), grade: "WATCH" }, stage: "market-ranking", reason: "No published setup. Market ranking is informational only.", lifecycle: null, generatedAt: new Date().toISOString(), source: "bybit", marketRank: m.rank, turnover24h: m.turnover24h, openInterest: m.openInterest, change24hPercent: Number(m.price24hPcnt || 0) * 100 }));
  marketFallbackCache = { signals, generatedAt: now };
  return signals;
}

function isPublishedTrade(signal) {
  if (!signal || signal.published !== true) return false;
  const status = String(signal.lifecycle?.status || signal.signalState || signal.status || "").toUpperCase();
  if (!PUBLISHED_SETUP_STATUSES.has(status)) return false;
  if (signal.valid !== true) return false;
  if (!signal.direction || !["LONG", "SHORT"].includes(signal.direction)) return false;

  const entry = Number(signal.entry);
  const stop = Number(signal.stop);
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return false;

  if (!Array.isArray(signal.targets) || signal.targets.length < 1) return false;
  if (!signal.targets.every((target) => Number.isFinite(Number(target?.price)))) return false;

  if (status === "READY") {
    if (!signal.setupType || !signal.timeframe || !signal.quality) return false;
    if (!Number.isFinite(Number(signal.riskReward)) || Number(signal.riskReward) < 1.5) return false;
  }

  return true;
}

function filterPublishedTrades(signals) {
  return (signals || []).filter(isPublishedTrade);
}

async function readScannerSnapshot() {
  const memory = getLatestScanResults();
  if (Array.isArray(memory) && memory.length) {
    const published = filterPublishedTrades(memory);
    return {
      signals: published,
      scanResults: published,
      scanner: {
        status: "LIVE",
        source: "scanner-memory",
        scannedSymbols: memory.length,
        publishedSignals: published.length,
        readySignals: published.filter(s => String(s.status).toUpperCase() === "READY").length,
        waitSignals: memory.filter(s => String(s.status).toUpperCase() === "WAIT").length,
        errorSignals: memory.filter(s => String(s.status).toUpperCase() === "ERROR").length,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const latest = await db.collection(SIGNALS_COLLECTION).doc(SIGNALS_DOCUMENT).get();
    if (latest.exists) {
      const data = latest.data() || {};
      const published = filterPublishedTrades(Array.isArray(data.signals) ? data.signals : []);
      return {
        ...data,
        signals: published,
        scanResults: published,
        scanner: {
          ...(data.scanner || {}),
          publishedSignals: published.length,
          readySignals: published.filter(s => String(s.status).toUpperCase() === "READY").length,
        },
      };
    }

    const publishedDocs = await db.collection(SIGNALS_COLLECTION).where("published", "==", true).get();
    const signals = filterPublishedTrades(
      publishedDocs.docs.map(doc => ({ ...doc.data(), signalId: doc.data().signalId || doc.id })),
    );
    const now = new Date().toISOString();
    return { signals, scanResults: signals, scanner: { status: signals.length ? "READY" : "WAITING", publishedSignals: signals.length, readySignals: signals.filter(s => String(s.status).toUpperCase() === "READY").length, waitSignals: 0, errorSignals: 0, updatedAt: now }, updatedAt: now, recovered: true };
  } catch (error) {
    throw error;
  }
}

async function ensureScannerData(data) {
  const source = Array.isArray(data?.scanResults) ? data.scanResults : Array.isArray(data?.signals) ? data.signals : [];
  if (source.length) return data;
  try {
    const fallback = await buildMarketFallback();
    const now = new Date().toISOString();
    return { ...data, signals: [], scanResults: [], scanner: { ...(data.scanner || {}), status: "WAITING", source: "bybit-market-fallback", scannedSymbols: 0, publishedSignals: 0, readySignals: 0, waitSignals: fallback.length, errorSignals: 0, updatedAt: now }, marketWatch: fallback, updatedAt: now };
  } catch (error) {
    return data;
  }
}

async function refreshLivePrices(signals) {
  return Promise.all((signals || []).map(async s => {
    const status = s.lifecycle?.status || s.signalState || s.status;
    if (!LIVE_STATUSES.has(status) || !s.symbol) return s;
    try {
      const t = await fetchTicker(s.symbol);
      if (Number.isFinite(t?.lastPrice) && t.lastPrice > 0) return { ...s, price: t.lastPrice };
    } catch (error) {}
    return s;
  }));
}

function protectExecutionData(signal) {
  const safe = { ...signal };
  const status = safe.lifecycle?.status || safe.signalState || safe.status;
  if (!LIVE_STATUSES.has(status)) return safe;
  delete safe.entry; delete safe.stop; delete safe.target; delete safe.entryZone; delete safe.reason;
  if (safe.lifecycle) {
    safe.lifecycle = { ...safe.lifecycle };
    if (Array.isArray(safe.lifecycle.targets)) safe.lifecycle.targets = safe.lifecycle.targets.map(t => { const x = { ...t }; delete x.price; return x; });
  }
  return safe;
}

async function signalsRoutes(req, res) {
  if (req.method !== "GET" || !req.url.startsWith("/api/signals")) return false;
  return requireAuth(req, res, async () => {
    let account = null, access = getAccessState(null);
    try {
      account = await getAccount(req.user.uid, req.user);
      access = getAccessState(account);
      let scannerData;
      try { scannerData = await readScannerSnapshot(); } catch (error) { scannerData = await ensureScannerData({}); }
      scannerData = await ensureScannerData(scannerData);
      const source = Array.isArray(scannerData.scanResults) ? scannerData.scanResults : Array.isArray(scannerData.signals) ? scannerData.signals : [];
      const responseSignals = await refreshLivePrices(filterPublishedTrades(source));
      const safeSignals = access.hasAccess ? responseSignals : responseSignals.map(protectExecutionData);
      return json(res, 200, { ok: true, data: { ...scannerData, signals: safeSignals, scanResults: safeSignals, access, subscribeRequired: !access.hasAccess, scanner: scannerData.scanner || null } });
    } catch (error) {
      console.error("❌ Signals route degraded:", error.stack || error.message || error);
      return json(res, 200, { ok: true, data: { signals: [], scanResults: [], access, subscribeRequired: !access.hasAccess, scanner: { status: "WAITING", source: "no-published-setups", scannedSymbols: 0, publishedSignals: 0, readySignals: 0, waitSignals: 0, errorSignals: 0, updatedAt: new Date().toISOString() }, degraded: true } });
    }
  });
}

module.exports = { signalsRoutes };
