const { randomUUID } = require("crypto");
require("dotenv").config();

const market = require("./src/tools/market");
const { analyzeMarket } = require("./src/tools/marketEngine");
const { buildMarketRanking } = require("./src/services/marketRanking");
const { db } = require("./src/services/firestore");

const SIGNALS_COLLECTION = "signals";
const MARKET_INTELLIGENCE_COLLECTION = "marketIntelligence";
const SIGNALS_DOCUMENT = "latest";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const PAIR_DELAY_MS = 1200;

let scannerRunning = false;
let scannerCycle = 0;

const CLOSED_STATES = new Set(["TP_HIT", "STOP_LOSS", "MISSED", "EXPIRED"]);

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function getLifecycleStatus(signal) {
  return normalizeStatus(
    signal?.lifecycle?.status ||
      signal?.signalState ||
      signal?.tradePlan?.lifecycleStatus ||
      signal?.tradePlan?.status ||
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

  return [signal?.symbol || "", direction, entry, stop, String(target)].join(
    "|",
  );
}

function hasExecutionLevels(plan = {}) {
  const entry = plan.entry ?? plan.entryZone?.entry;

  const stop = plan.stop ?? plan.stopLoss ?? plan.entryZone?.stop;

  const target =
    plan.target ??
    plan.takeProfit ??
    plan.targets?.[0]?.price ??
    plan.targets?.[0];

  return (
    Number.isFinite(Number(entry)) &&
    Number.isFinite(Number(stop)) &&
    Number.isFinite(Number(target))
  );
}

/*
 * IMPORTANT:
 *
 * This function does NOT decide whether a setup
 * is technically valid.
 *
 * The current intelligence engine remains the
 * authority for:
 *
 * structure
 * liquidity
 * displacement
 * regime
 * confluence
 * signal
 *
 * The scanner only preserves lifecycle state
 * that already exists.
 */
function mergeLifecycle(result, previousSignal) {
  if (!result) {
    return null;
  }

  const plan = result.tradePlan || {};

  const currentIdentity = getSetupIdentity(result);

  const previousIdentity =
    previousSignal?.setupIdentity || getSetupIdentity(previousSignal || {});

  const sameSetup =
    Boolean(previousSignal) && currentIdentity === previousIdentity;

  const previousStatus = sameSetup ? getLifecycleStatus(previousSignal) : "";

  /*
   * Terminal states are immutable.
   */
  if (sameSetup && CLOSED_STATES.has(previousStatus)) {
    return {
      ...result,

      setupIdentity: currentIdentity,

      lifecycle: previousSignal.lifecycle || null,

      signalState: previousStatus,

      tradePlan: {
        ...plan,
        status: previousStatus,
        lifecycleStatus: previousStatus,
      },

      published: true,

      updatedAt: new Date().toISOString(),
    };
  }

  /*
   * ACTIVE survives temporary engine
   * non-qualification for the same setup.
   */
  if (sameSetup && previousStatus === "ACTIVE") {
    return {
      ...result,

      setupIdentity: currentIdentity,

      lifecycle: previousSignal.lifecycle || null,

      signalState: "ACTIVE",

      tradePlan: {
        ...plan,
        status: "ACTIVE",
        lifecycleStatus: "ACTIVE",
      },

      published: true,

      updatedAt: new Date().toISOString(),
    };
  }

  /*
   * Preserve the complete current engine
   * response untouched.
   *
   * No new trading rules are inserted here.
   */
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

    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].data();
  } catch (error) {
    console.warn(
      `⚠️ Previous signal lookup failed for ${symbol}:`,
      error.message || error,
    );

    return null;
  }
}

async function publishSymbolSignal(signal) {
  if (!signal?.symbol) {
    return;
  }

  const signalId =
    signal.signalId ||
    `ks_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;

  const historicalSignal = {
    ...signal,
    signalId,
    published: true,
    publishedAt: signal.publishedAt || new Date().toISOString(),
  };

  await db
    .collection(SIGNALS_COLLECTION)
    .doc(signalId)
    .set(historicalSignal, {
      merge: true,
    });

  console.log(`💾 ${signal.symbol} published`);
}

/*
 * Build the frontend snapshot.
 *
 * IMPORTANT:
 *
 * We retain the actual intelligence payload:
 *
 * signals
 * setups
 * regime
 * ticker
 * availableTimeframes
 * market
 * structures
 * liquidity
 * displacements
 * generatedAt
 *
 * Nothing is reconstructed from scratch.
 */
function buildFrontendSnapshot(results) {
  const validResults = results.filter(Boolean);

  const signals = [];
  const setups = {};

  /*
   * IMPORTANT:
   *
   * Full per-market intelligence is now stored in
   * marketIntelligence/{symbol}.
   *
   * signals/latest is deliberately kept small.
   */

  for (const result of validResults) {
    const symbol = result.symbol;

    if (!symbol) {
      continue;
    }

    if (result.setups && typeof result.setups === "object") {
      setups[symbol] = result.setups;
    }

    if (Array.isArray(result.signals)) {
      for (const signal of result.signals) {
        signals.push({
          ...signal,
          symbol,
          setupIdentity: getSetupIdentity({
            ...result,
            tradePlan: signal,
          }),
          lifecycle: result.lifecycle || null,
          signalState: result.signalState || null,
        });
      }
    }
  }

  const primary =
    validResults.find((result) => result.symbol === "BTCUSDT") ||
    validResults[0] ||
    null;

  return {
    ok: true,

    signals,

    setups,

    regime: primary?.regime || null,

    access: null,

    subscribeRequired: false,

    generatedAt: new Date().toISOString(),

    symbol: primary?.symbol || "BTCUSDT",

    ticker: primary?.ticker || null,

    availableTimeframes: primary?.availableTimeframes || [],

    /*
     * DO NOT store the full markets object here.
     *
     * It belongs in:
     *
     * marketIntelligence/{symbol}
     */
    markets: {},

    market: primary?.market || null,

    /*
     * Keep only the primary market in latest.
     * The API reconstructs the complete markets object.
     */
    primary: primary
      ? {
          ...primary,
        }
      : null,

    scanner: {
      cycle: scannerCycle,

      scannedSymbols: validResults.length,

      publishedSignals: signals.length,

      updatedAt: new Date().toISOString(),
    },
  };
}

async function saveMarketIntelligence(result) {
  if (!result?.symbol) {
    return;
  }

  await db
    .collection(MARKET_INTELLIGENCE_COLLECTION)
    .doc(result.symbol)
    .set(result);

  console.log(`🧠 ${result.symbol}: intelligence stored`);
}

async function saveFrontendSnapshot(snapshot) {
  await db.collection(SIGNALS_COLLECTION).doc(SIGNALS_DOCUMENT).set(snapshot);

  console.log(
    `📡 Frontend snapshot updated: ` +
      `${snapshot.signals.length} signals / ` +
      `${Object.keys(snapshot.markets).length} markets`,
  );
}

async function cleanupStaleSignals(activeSymbols) {
  try {
    const snapshot = await db.collection(SIGNALS_COLLECTION).get();

    const staleRefs = [];

    snapshot.forEach((doc) => {
      // The frontend snapshot is never cleaned.
      if (doc.id === SIGNALS_DOCUMENT) {
        return;
      }

      const data = doc.data() || {};

      // Published signals are historical records.
      // They must NEVER be deleted by stale-symbol cleanup.
      if (data.published === true) {
        return;
      }

      // Only legacy/non-published symbol records can be cleaned.
      if (activeSymbols.has(doc.id)) {
        return;
      }

      staleRefs.push(doc.ref);
    });

    for (let i = 0; i < staleRefs.length; i += 450) {
      const batch = db.batch();

      const chunk = staleRefs.slice(i, i + 450);

      for (const ref of chunk) {
        batch.delete(ref);
      }

      await batch.commit();
    }

    console.log(
      `🧹 Stale non-published records removed: ${staleRefs.length}`,
    );
  } catch (error) {
    console.error(
      "❌ Stale signal cleanup failed:",
      error.message || error,
    );
  }
}

async function scanSymbol(symbol) {
  try {
    console.log(`🔍 Scanning ${symbol}`);

    /*
     * THE CURRENT ENGINE IS THE AUTHORITY.
     *
     * No scanner-side trading logic.
     */
    const result = await analyzeMarket(symbol);

    if (!result) {
      console.log(`   └─ no intelligence returned`);

      return null;
    }

    /*
     * Store the complete engine result separately.
     *
     * signals/latest remains a compact frontend index.
     */
    await saveMarketIntelligence(result);

    const actionableSignals = Array.isArray(result.signals)
      ? result.signals
      : [];

    /*
     * ONLY actionable/trade-ready signals
     * are allowed into the published feed.
     */
    if (actionableSignals.length === 0) {
      /*
       * IMPORTANT:
       * Never delete a previously published signal here.
       *
       * The live feed may have no actionable signal right now,
       * but historical signal records must remain available
       * for lifecycle tracking and track-record history.
       */
      console.log(
        `   └─ ${symbol}: 0 actionable signal(s) — historical record retained`,
      );

      /*
       * IMPORTANT:
       *
       * The market scan itself succeeded.
       *
       * A WAIT/ARMED market must remain available to the
       * frontend even though it is not an actionable signal.
       *
       * Returning the result here allows buildFrontendSnapshot()
       * to preserve the complete market intelligence universe.
       */
      return result;
    }
    const previousSignal = await loadPreviousSignal(symbol);

    const signal = mergeLifecycle(result, previousSignal);
    await publishSymbolSignal(signal);

    console.log(
      `   └─ ${symbol}: ` +
        `${actionableSignals.length} actionable signal(s) — PUBLISHED`,
    );

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
  /*
   * QUALITY-FIRST MARKET SELECTION
   *
   * Rank the complete Bybit universe first.
   * Only the top 100 highest-quality markets
   * are allowed into the intelligence engine.
   */
  const ranking = await buildMarketRanking();

  const rankedMarkets = Array.isArray(ranking?.rankedMarkets)
    ? ranking.rankedMarkets
    : [];

  const topMarkets = rankedMarkets.slice(0, 100);

  const symbols = topMarkets.map((item) => item?.symbol).filter(Boolean);

  if (symbols.length === 0) {
    console.warn(
      "⚠️ No quality-ranked markets returned. Existing frontend snapshot preserved.",
    );

    return;
  }

  console.log(`🏆 Quality universe: ${rankedMarkets.length} ranked markets`);

  console.log(`🎯 Scanner universe: TOP ${symbols.length} quality markets`);

  if (ranking.dailyLeader) {
    console.log(
      `🥇 Daily leader: ${ranking.dailyLeader.symbol} ` +
        `— Quality ${ranking.dailyLeader.scores?.quality ?? "N/A"}`,
    );
  }

  const results = [];
  const activeSymbols = new Set();

  let failures = 0;

  /*
   * Controlled scanner concurrency.
   *
   * Eight markets are scanned concurrently.
   * Each batch completes before the next batch starts.
   *
   * This removes the old sequential 1.2s-per-pair
   * bottleneck while avoiding hundreds of simultaneous
   * requests against the exchange.
   */
  const SCAN_CONCURRENCY = 8;

  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const batch = symbols.slice(i, i + SCAN_CONCURRENCY);

    console.log(
      `⚡ Batch ${Math.floor(i / SCAN_CONCURRENCY) + 1}: ` +
        `${batch.length} markets`,
    );

    const batchResults = await Promise.all(
      batch.map((symbol) => scanSymbol(symbol)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];

      const symbol = batch[j];

      if (result) {
        /*
         * PRESERVE ALL SUCCESSFUL MARKET INTELLIGENCE.
         *
         * WAIT / WATCH / ARMED markets must remain in
         * results[] so buildFrontendSnapshot() can expose
         * them to the frontend.
         */
        results.push(result);

        /*
         * ACTIVE LIFECYCLE IS SEPARATE FROM SCANNED DATA.
         *
         * Only markets with actionable signals participate
         * in active-symbol lifecycle cleanup.
         */
        const actionableSignals = Array.isArray(result.signals)
          ? result.signals
          : [];

        if (actionableSignals.length > 0) {
          activeSymbols.add(symbol);

          console.log(
            `   └─ ${symbol}: ${actionableSignals.length} actionable signal(s) — ACTIVE`,
          );
        }
      } else {
        /*
         * A null result means the scan itself failed.
         * Count it so destructive cleanup is skipped.
         */
        failures++;

        console.warn(`   └─ ${symbol}: scan failed — excluded from snapshot`);
      }
    }
  }

  /*
   * If some symbols failed, do not let the
   * cleanup process erase their previous
   * records.
   *
   * This is important for frontend stability.
   */
  if (failures === 0) {
    await cleanupStaleSignals(activeSymbols);
  } else {
    console.warn(
      `⚠️ ${failures} symbol scan(s) failed. ` +
        `Skipping destructive cleanup.`,
    );
  }

  /*
   * Build the canonical frontend payload
   * from the actual engine responses.
   */
  const frontendSnapshot = buildFrontendSnapshot(results);

  /*
   * Never overwrite the frontend snapshot
   * with an empty result caused by a failed scan.
   */
  if (results.length > 0 || failures === 0) {
    await saveFrontendSnapshot(frontendSnapshot);
  }

  const duration = Math.round((Date.now() - startedAt) / 1000);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log(`🏁 Scan #${scannerCycle} finished`);

  console.log(`⏱️ Duration: ${duration}s`);

  console.log(`📊 Markets: ${results.length}/${symbols.length}`);

  console.log(`🎯 Actionable signals: ${frontendSnapshot.signals.length}`);

  console.log("");
}

async function start() {
  console.log("🚀 KitSetups scanner starting...");

  console.log("🧠 Engine: current market intelligence");

  console.log("📡 Output: Firestore → frontend");

  console.log();

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
      console.error(
        "❌ Scanner cycle failed:",
        error.stack || error.message || error,
      );
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
};

if (require.main === module) {
  start().catch((error) => {
    console.error(
      "❌ Scanner fatal error:",
      error.stack || error.message || error,
    );

    process.exit(1);
  });
}
