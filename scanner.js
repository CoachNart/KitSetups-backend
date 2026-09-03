const { randomUUID } = require("crypto");
require("dotenv").config();

const { analyzeMarket } = require("./src/tools/marketEngine");
const { buildMarketRanking } = require("./src/services/marketRanking");
const { db } = require("./src/services/firestore");

const SIGNALS_COLLECTION = "signals";
const MARKET_INTELLIGENCE_COLLECTION = "marketIntelligence";
const SIGNALS_DOCUMENT = "latest";
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const CLOSED_STATES = new Set(["TP_HIT", "STOP_LOSS", "MISSED", "EXPIRED", "CLOSED"]);

let scannerRunning = false;
let scannerCycle = 0;
let latestScanResults = [];

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function getLifecycleStatus(signal) {
  return normalizeStatus(
    signal?.lifecycle?.status ||
      signal?.signalState ||
      signal?.tradePlan?.lifecycleStatus ||
      signal?.tradePlan?.status ||
      signal?.status ||
      "",
  );
}

function getSetupIdentity(signal) {
  const plan = signal?.tradePlan || signal || {};
  const direction = plan.direction || plan.bias || "";
  const entry =
    typeof plan.entry === "object"
      ? [plan.entry?.min ?? "", plan.entry?.max ?? ""].join(":")
      : String(plan.entry ?? "");
  const stop = String(plan.stop ?? plan.stopLoss ?? "");
  const target =
    plan.target ??
    plan.takeProfit ??
    plan.targets?.[0]?.price ??
    plan.targets?.[0] ??
    "";
  return [signal?.symbol || "", direction, entry, stop, String(target)].join("|");
}

function mergeLifecycle(result, previousSignal) {
  if (!result) return null;

  const currentIdentity = getSetupIdentity(result);
  const previousIdentity =
    previousSignal?.setupIdentity || getSetupIdentity(previousSignal || {});
  const sameSetup = Boolean(previousSignal) && currentIdentity === previousIdentity;
  const previousStatus = sameSetup ? getLifecycleStatus(previousSignal) : "";

  if (sameSetup && CLOSED_STATES.has(previousStatus)) {
    return {
      ...result,
      setupIdentity: currentIdentity,
      lifecycle: previousSignal.lifecycle || result.lifecycle || null,
      signalState: previousStatus,
      published: true,
      updatedAt: new Date().toISOString(),
    };
  }

  if (sameSetup && previousStatus === "ACTIVE") {
    return {
      ...result,
      setupIdentity: currentIdentity,
      lifecycle: previousSignal.lifecycle || result.lifecycle || null,
      signalState: "ACTIVE",
      published: true,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    ...result,
    setupIdentity: currentIdentity,
    signalState: getLifecycleStatus(result) || null,
    published: true,
    updatedAt: new Date().toISOString(),
  };
}

async function loadPreviousSignal(symbol) {
  try {
    const snapshot = await db
      .collection(SIGNALS_COLLECTION)
      .where("symbol", "==", symbol)
      .where("published", "==", true)
      .orderBy("publishedAt", "desc")
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data();
  } catch (error) {
    console.warn(`⚠️ Previous signal lookup failed for ${symbol}:`, error.message || error);
    return null;
  }
}

async function publishSymbolSignal(signal) {
  if (!signal?.symbol) return;

  const signalId =
    signal.signalId ||
    `ks_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;

  await db.collection(SIGNALS_COLLECTION).doc(signalId).set(
    {
      ...signal,
      signalId,
      published: true,
      publishedAt: signal.publishedAt || new Date().toISOString(),
    },
    { merge: true },
  );

  console.log(`💾 ${signal.symbol} published`);
}

function compactSignal(signal, symbol, fallbackLifecycle = null) {
  if (!signal || typeof signal !== "object") return null;

  const lifecycle = signal.lifecycle || fallbackLifecycle || null;
  const compact = {
    signalId: signal.signalId || null,
    symbol: signal.symbol || symbol || null,
    status: signal.status || getLifecycleStatus(signal) || "WAIT",
    valid: signal.valid === true,
    direction: signal.direction || null,
    setupType: signal.setupType || null,
    marketRegime: signal.marketRegime || null,
    timeframe: signal.timeframe || null,
    price: Number.isFinite(Number(signal.price)) ? Number(signal.price) : null,
    entry: Number.isFinite(Number(signal.entry)) ? Number(signal.entry) : null,
    stop: Number.isFinite(Number(signal.stop)) ? Number(signal.stop) : null,
    risk: Number.isFinite(Number(signal.risk)) ? Number(signal.risk) : null,
    targets: Array.isArray(signal.targets)
      ? signal.targets.slice(0, 3).map((target, index) => ({
          index: target?.index || index + 1,
          price: Number.isFinite(Number(target?.price)) ? Number(target.price) : null,
          riskReward: Number.isFinite(Number(target?.riskReward)) ? Number(target.riskReward) : null,
          liquidityClass: target?.liquidityClass || null,
        }))
      : [],
    riskReward: Number.isFinite(Number(signal.riskReward)) ? Number(signal.riskReward) : null,
    quality: signal.quality
      ? {
          score: Number(signal.quality.score || 0),
          grade: signal.quality.grade || null,
          confidence: signal.quality.confidence || null,
          components: signal.quality.components || {},
        }
      : { score: 0, grade: "D", confidence: "Low", components: {} },
    thesis: signal.thesis || {},
    reasons: Array.isArray(signal.reasons) ? signal.reasons.slice(0, 8) : [],
    lifecycle,
    signalState: signal.signalState || getLifecycleStatus(signal) || null,
    setupIdentity: signal.setupIdentity || getSetupIdentity(signal),
    stage: signal.stage || null,
    generatedAt: signal.generatedAt || new Date().toISOString(),
    published: signal.published === true,
  };

  return compact;
}

function compactResult(result) {
  const signals = Array.isArray(result?.signals)
    ? result.signals.map((signal) => compactSignal(signal, result.symbol, result.lifecycle)).filter(Boolean)
    : [];

  return {
    symbol: result?.symbol || null,
    status: result?.status || (signals.length ? "READY" : "WAIT"),
    valid: result?.valid === true,
    direction: result?.direction || null,
    setupType: result?.setupType || null,
    marketRegime: result?.marketRegime || result?.regime || null,
    timeframe: result?.timeframe || null,
    price: Number.isFinite(Number(result?.price)) ? Number(result.price) : null,
    entry: Number.isFinite(Number(result?.entry)) ? Number(result.entry) : null,
    stop: Number.isFinite(Number(result?.stop)) ? Number(result.stop) : null,
    targets: Array.isArray(result?.targets) ? result.targets.slice(0, 3) : [],
    riskReward: Number.isFinite(Number(result?.riskReward)) ? Number(result.riskReward) : null,
    quality: result?.quality
      ? {
          score: Number(result.quality.score || 0),
          grade: result.quality.grade || null,
          confidence: result.quality.confidence || null,
          components: result.quality.components || {},
        }
      : { score: 0, grade: "D", confidence: "Low", components: {} },
    thesis: result?.thesis || {},
    reasons: Array.isArray(result?.reasons) ? result.reasons.slice(0, 8) : [],
    lifecycle: result?.lifecycle || null,
    signalState: result?.signalState || null,
    generatedAt: result?.generatedAt || new Date().toISOString(),
    signals,
  };
}

async function buildFrontendSnapshot(results) {
  const validResults = results.filter(Boolean);
  const signals = [];
  const setups = {};

  for (const result of validResults) {
    const symbol = result.symbol;
    if (!symbol) continue;

    const compact = compactResult(result);

    if (compact.signals.length) {
      for (const signal of compact.signals) {
        signals.push(signal);
      }
    } else {
      // Keep WAIT markets available without embedding their full analysis payload.
      signals.push({
        symbol,
        status: compact.status || "WAIT",
        valid: false,
        direction: null,
        setupType: null,
        marketRegime: compact.marketRegime,
        timeframe: null,
        price: compact.price,
        entry: null,
        stop: null,
        risk: null,
        targets: [],
        riskReward: null,
        quality: compact.quality,
        thesis: compact.thesis,
        reasons: compact.reasons,
        lifecycle: null,
        signalState: compact.signalState,
        setupIdentity: getSetupIdentity({ symbol, ...compact }),
        stage: null,
        generatedAt: compact.generatedAt,
        published: false,
      });
    }

    if (Array.isArray(result.setups) || (result.setups && typeof result.setups === "object")) {
      setups[symbol] = result.setups;
    }
  }

  // Preserve currently ACTIVE published setups, but only in their compact form.
  try {
    const activeSnapshot = await db
      .collection(SIGNALS_COLLECTION)
      .where("published", "==", true)
      .get();

    for (const doc of activeSnapshot.docs) {
      const persisted = doc.data() || {};
      if (getLifecycleStatus(persisted) !== "ACTIVE" || !persisted.symbol) continue;

      const compact = compactSignal(persisted, persisted.symbol, persisted.lifecycle);
      if (!compact) continue;

      const exists = signals.some(
        (signal) =>
          (signal.setupIdentity || getSetupIdentity(signal)) ===
          (compact.setupIdentity || getSetupIdentity(compact)),
      );

      if (!exists) signals.push(compact);
    }
  } catch (error) {
    console.warn("⚠️ Persisted ACTIVE signal merge failed:", error.message || error);
  }

  const primary =
    validResults.find((result) => result.symbol === "BTCUSDT") ||
    validResults[0] ||
    null;

  return {
    ok: true,
    signals: signals.slice(0, 100),
    setups,
    regime: primary?.regime || primary?.marketRegime || null,
    access: null,
    subscribeRequired: false,
    generatedAt: new Date().toISOString(),
    symbol: primary?.symbol || "BTCUSDT",
    ticker: primary?.ticker || null,
    availableTimeframes: Array.isArray(primary?.availableTimeframes) ? primary.availableTimeframes : [],
    markets: {},
    market: primary?.market || null,
    primary: primary ? compactResult(primary) : null,
    scanner: {
      cycle: scannerCycle,
      scannedSymbols: validResults.length,
      publishedSignals: signals.filter((signal) => signal.valid && getLifecycleStatus(signal) !== "WAIT").length,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function saveMarketIntelligence(result) {
  if (!result?.symbol) return;
  await db.collection(MARKET_INTELLIGENCE_COLLECTION).doc(result.symbol).set(result);
  console.log(`🧠 ${result.symbol}: intelligence stored`);
}

async function saveFrontendSnapshot(snapshot) {
  // The snapshot is deliberately compact. Full structure/liquidity/momentum
  // analysis lives in marketIntelligence/{symbol}, not signals/latest.
  await db.collection(SIGNALS_COLLECTION).doc(SIGNALS_DOCUMENT).set(snapshot);
  console.log(`📡 Frontend snapshot updated: ${snapshot.signals.length} signals`);
}

async function cleanupStaleSignals(activeSymbols) {
  try {
    const snapshot = await db.collection(SIGNALS_COLLECTION).get();
    const staleRefs = [];

    snapshot.forEach((doc) => {
      if (doc.id === SIGNALS_DOCUMENT) return;
      const data = doc.data() || {};
      if (data.published === true) return;
      if (activeSymbols.has(doc.id)) return;
      staleRefs.push(doc.ref);
    });

    for (let i = 0; i < staleRefs.length; i += 450) {
      const batch = db.batch();
      for (const ref of staleRefs.slice(i, i + 450)) batch.delete(ref);
      await batch.commit();
    }

    console.log(`🧹 Stale non-published records removed: ${staleRefs.length}`);
  } catch (error) {
    console.error("❌ Stale signal cleanup failed:", error.message || error);
  }
}

async function scanSymbol(symbol) {
  try {
    console.log(`🔍 Scanning ${symbol}`);
    const result = await analyzeMarket(symbol);
    if (!result) return null;

    await saveMarketIntelligence(result);

    const readySignals = Array.isArray(result.signals)
      ? result.signals.filter((signal) => getLifecycleStatus(signal) === "READY")
      : [];

    if (!readySignals.length) {
      console.log(`   └─ ${symbol}: 0 actionable signal(s) — historical record retained`);
      return result;
    }

    const previousSignal = await loadPreviousSignal(symbol);
    const publishResult = { ...result, signals: readySignals };
    const signal = mergeLifecycle(publishResult, previousSignal);
    await publishSymbolSignal(signal);

    console.log(`   └─ ${symbol}: ${readySignals.length} READY signal(s) — PUBLISHED`);
    return signal;
  } catch (error) {
    console.error(`❌ ${symbol}:`, error.stack || error.message || error);
    return null;
  }
}

async function runScanner() {
  scannerCycle++;
  const startedAt = Date.now();

  console.log("");
  console.log(`🚀 KITSETUPS SCAN #${scannerCycle}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const ranking = await buildMarketRanking();
  const rankedMarkets = Array.isArray(ranking?.rankedMarkets) ? ranking.rankedMarkets : [];
  const topMarkets = rankedMarkets.slice(0, 200);
  const symbols = topMarkets.map((item) => item?.symbol).filter(Boolean);

  if (!symbols.length) {
    console.warn("⚠️ No quality-ranked markets returned. Existing frontend snapshot preserved.");
    return;
  }

  console.log(`🏆 Quality universe: ${rankedMarkets.length} ranked markets`);
  console.log(`🎯 Scanner universe: TOP ${symbols.length} quality markets`);

  const results = [];
  const activeSymbols = new Set();
  let failures = 0;
  const SCAN_CONCURRENCY = 8;

  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const batch = symbols.slice(i, i + SCAN_CONCURRENCY);
    console.log(`⚡ Batch ${Math.floor(i / SCAN_CONCURRENCY) + 1}: ${batch.length} markets`);

    const batchResults = await Promise.all(batch.map((symbol) => scanSymbol(symbol)));

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const symbol = batch[j];

      if (!result) {
        failures++;
        console.warn(`   └─ ${symbol}: scan failed — excluded from snapshot`);
        continue;
      }

      results.push(result);
      const actionableSignals = Array.isArray(result.signals) ? result.signals : [];
      if (actionableSignals.length) activeSymbols.add(symbol);
    }
  }

  if (failures === 0) {
    await cleanupStaleSignals(activeSymbols);
  } else {
    console.warn(`⚠️ ${failures} symbol scan(s) failed. Skipping destructive cleanup.`);
  }

  const frontendSnapshot = await buildFrontendSnapshot(results);
  if (results.length > 0 || failures === 0) {
    await saveFrontendSnapshot(frontendSnapshot);
  }

  latestScanResults = results.map((result) => compactResult(result));

  const duration = Math.round((Date.now() - startedAt) / 1000);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🏁 Scan #${scannerCycle} finished`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log(`📊 Markets: ${results.length}/${symbols.length}`);
  console.log(`🎯 Actionable signals: ${frontendSnapshot.signals.filter((s) => s.valid).length}`);
  console.log("");
}

function getLatestScanResults() {
  return latestScanResults;
}

async function start() {
  console.log("🚀 KitSetups scanner starting...");
  console.log("🧠 Engine: current market intelligence");
  console.log("📡 Output: Firestore → frontend");
  console.log(`⏱️ Scan interval: ${SCAN_INTERVAL_MS / 60000} minutes`);

  async function runSafely() {
    if (scannerRunning) {
      console.log("⏳ Previous scan still running — skipping.");
      return;
    }

    scannerRunning = true;
    try {
      await runScanner();
    } catch (error) {
      console.error("❌ Scanner cycle failed:", error.stack || error.message || error);
    } finally {
      scannerRunning = false;
    }
  }

  await runSafely();
  setInterval(runSafely, SCAN_INTERVAL_MS);
}

module.exports = {
  start,
  runScanner,
  getLatestScanResults,
};

if (require.main === module) {
  start().catch((error) => {
    console.error("❌ Scanner fatal error:", error.stack || error.message || error);
    process.exit(1);
  });
}
