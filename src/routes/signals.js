const { userRef, db } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");
const { fetchTicker } = require("../trading/data/marketData");
const { buildMarketRanking } = require("../services/marketRanking");
const { getLatestScanResults } = require("../scanner/runner");

const SIGNALS_COLLECTION = "signals";
const SIGNALS_DOCUMENT = "latest";
const LIVE_STATUSES = new Set(["READY", "ENTRY_HIT", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT"]);
const MARKET_FALLBACK_LIMIT = 20;
const MARKET_FALLBACK_CACHE_MS = 60 * 1000;
const ACCOUNT_CACHE_TTL_MS = 60 * 1000;

let marketFallbackCache = { signals: [], generatedAt: 0 };
const accountCache = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-KitSetups-Device",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

async function getAccount(uid) {
  const cached = accountCache.get(uid);
  if (cached && Date.now() - cached.cachedAt < ACCOUNT_CACHE_TTL_MS) return cached.account;

  try {
    const accountSnap = await userRef(uid).get();
    const account = accountSnap.exists ? accountSnap.data() : null;
    if (account) accountCache.set(uid, { account, cachedAt: Date.now() });
    return account;
  } catch (error) {
    if (cached) return cached.account;
    throw error;
  }
}

async function buildMarketFallback() {
  const now = Date.now();
  if (marketFallbackCache.signals.length > 0 && now - marketFallbackCache.generatedAt < MARKET_FALLBACK_CACHE_MS) return marketFallbackCache.signals;
  const ranking = await buildMarketRanking();
  const signals = (ranking.rankedMarkets || []).slice(0, MARKET_FALLBACK_LIMIT).map((market) => ({
    symbol: market.symbol,
    price: Number(market.lastPrice),
    status: "WAIT",
    valid: false,
    direction: null,
    entry: null,
    stop: null,
    targets: [],
    riskReward: null,
    quality: { score: Number(market.scores?.quality || 0), grade: "WATCH" },
    stage: "market-ranking",
    reason: "Market ranked by Bybit while the trading scanner completes its next cycle.",
    lifecycle: null,
    generatedAt: new Date().toISOString(),
    source: "bybit",
    marketRank: market.rank,
    turnover24h: market.turnover24h,
    openInterest: market.openInterest,
    change24hPercent: Number(market.price24hPcnt || 0) * 100,
  }));
  marketFallbackCache = { signals, generatedAt: now };
  return signals;
}

async function readScannerSnapshot() {
  try {
    const latest = await db.collection(SIGNALS_COLLECTION).doc(SIGNALS_DOCUMENT).get();
    if (latest.exists) return latest.data() || {};
    const published = await db.collection(SIGNALS_COLLECTION).where("published", "==", true).get();
    const signals = published.docs.map((doc) => ({ ...doc.data(), signalId: doc.data().signalId || doc.id })).filter((signal) => LIVE_STATUSES.has(signal.lifecycle?.status || signal.signalState || signal.status));
    const now = new Date().toISOString();
    return { signals, scanResults: signals, scanner: { status: signals.length > 0 ? "READY" : "WAITING", publishedSignals: signals.length, readySignals: signals.length, waitSignals: 0, errorSignals: 0, updatedAt: now }, updatedAt: now, recovered: true };
  } catch (error) {
    const inMemory = getLatestScanResults();
    if (Array.isArray(inMemory) && inMemory.length > 0) {
      const readySignals = inMemory.filter((signal) => signal.status === "READY" && signal.valid === true).length;
      console.warn("⚠️ Firestore snapshot unavailable; serving latest in-memory scanner results.");
      return { signals: inMemory, scanResults: inMemory, scanner: { status: "DEGRADED", source: "scanner-memory", scannedSymbols: inMemory.length, publishedSignals: readySignals, readySignals, waitSignals: inMemory.filter((signal) => signal.status === "WAIT").length, errorSignals: inMemory.filter((signal) => signal.status === "ERROR").length, updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString(), recovered: true };
    }
    throw error;
  }
}

async function ensureScannerData(scannerData) {
  const source = Array.isArray(scannerData?.scanResults) ? scannerData.scanResults : Array.isArray(scannerData?.signals) ? scannerData.signals : [];
  if (source.length > 0) return scannerData;
  try {
    const fallback = await buildMarketFallback();
    const now = new Date().toISOString();
    return { ...scannerData, signals: fallback, scanResults: fallback, scanner: { ...(scannerData.scanner || {}), status: "WAITING", source: "bybit-market-fallback", scannedSymbols: 0, publishedSignals: 0, readySignals: 0, waitSignals: fallback.length, errorSignals: 0, updatedAt: now }, updatedAt: now };
  } catch (error) {
    console.warn("⚠️ Bybit market fallback failed:", error.message || error);
    return scannerData;
  }
}

async function refreshLivePrices(signals) {
  return Promise.all((signals || []).map(async (signal) => {
    const status = signal.lifecycle?.status || signal.signalState || signal.status;
    if (!LIVE_STATUSES.has(status) || !signal.symbol) return signal;
    try {
      const ticker = await fetchTicker(signal.symbol);
      if (Number.isFinite(ticker?.lastPrice) && ticker.lastPrice > 0) return { ...signal, price: ticker.lastPrice };
    } catch (error) {
      console.warn(`⚠️ Live price refresh failed for ${signal.symbol}:`, error.message || error);
    }
    return signal;
  }));
}

function protectExecutionData(signal) {
  const safeSignal = { ...signal };
  const status = safeSignal.lifecycle?.status || safeSignal.signalState || safeSignal.status;
  if (!LIVE_STATUSES.has(status)) return safeSignal;
  delete safeSignal.entry;
  delete safeSignal.stop;
  delete safeSignal.target;
  delete safeSignal.entryZone;
  delete safeSignal.reason;
  if (safeSignal.lifecycle) {
    safeSignal.lifecycle = { ...safeSignal.lifecycle };
    if (Array.isArray(safeSignal.lifecycle.targets)) safeSignal.lifecycle.targets = safeSignal.lifecycle.targets.map((target) => { const safeTarget = { ...target }; delete safeTarget.price; return safeTarget; });
  }
  return safeSignal;
}

async function signalsRoutes(req, res) {
  if (req.method !== "GET" || !req.url.startsWith("/api/signals")) return false;

  return requireAuth(req, res, async () => {
    let account = null;
    let access = getAccessState(null);
    try {
      const uid = req.user.uid;
      try { account = await getAccount(uid); } catch (error) { console.warn("⚠️ Account lookup unavailable; continuing in locked mode:", error.message || error); }
      access = getAccessState(account);

      let scannerData;
      try { scannerData = await readScannerSnapshot(); } catch (error) { scannerData = await ensureScannerData({}); }
      scannerData = await ensureScannerData(scannerData);

      const sourceSignals = Array.isArray(scannerData.scanResults) ? scannerData.scanResults : Array.isArray(scannerData.signals) ? scannerData.signals : [];
      const responseSignals = await refreshLivePrices(sourceSignals);
      const safeSignals = access.hasAccess ? responseSignals : responseSignals.map(protectExecutionData);

      return json(res, 200, { ok: true, data: { ...scannerData, signals: safeSignals, scanResults: safeSignals, access, subscribeRequired: !access.hasAccess, scanner: scannerData.scanner || null } });
    } catch (error) {
      console.error("❌ Signals route degraded:", error.stack || error.message || error);
      let fallbackSignals = [];
      try { fallbackSignals = await buildMarketFallback(); } catch (fallbackError) { console.error("❌ Signals final fallback failed:", fallbackError.stack || fallbackError.message || fallbackError); }
      return json(res, 200, { ok: true, data: { signals: fallbackSignals, scanResults: fallbackSignals, access, subscribeRequired: !access.hasAccess, scanner: { status: "DEGRADED", source: fallbackSignals.length > 0 ? "bybit-market-fallback" : "unavailable", scannedSymbols: 0, publishedSignals: 0, readySignals: 0, waitSignals: fallbackSignals.length, errorSignals: 0, updatedAt: new Date().toISOString() }, degraded: true } });
    }
  });
}

module.exports = { signalsRoutes };
