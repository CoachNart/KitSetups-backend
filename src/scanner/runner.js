"use strict";

const { getUniverse, DEFAULT_UNIVERSE } = require("./universe");
const { scanSymbol } = require("./scanner");
const { initializeLifecycle, updateLifecycle } = require("../lifecycle/service");
const {
  publishScannerSnapshot,
  publishScannerReadModel,
  refreshScannerSnapshot,
  updatePublishedLifecycle,
  getPublishedSetupForSymbol,
} = require("./persistence");

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SCAN_SYMBOLS = 40;

let scannerLoopRunning = false;
let scannerLoopTimer = null;
let latestScanResults = [];

const scannerRuntime = {
  status: "STARTING",
  startedAt: null,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null,
  scannedSymbols: 0,
  ready: 0,
  wait: 0,
  errors: 0,
  nextCycleAt: null,
  persistenceDegraded: false,
};

async function processSnapshot(snapshot) {
  if (!snapshot) throw new Error("snapshot is required");

  if (snapshot.status !== "READY" || snapshot.valid !== true) {
    const existing = await getPublishedSetupForSymbol(snapshot.symbol);

    if (existing && Number.isFinite(Number(snapshot.price)) && Number(snapshot.price) > 0) {
      const updated = await updateLifecycle(existing, snapshot.price);
      await updatePublishedLifecycle(existing, updated.lifecycle);
      return {
        symbol: snapshot.symbol,
        status: snapshot.status,
        lifecycle: updated.lifecycle,
        action: "LIFECYCLE_UPDATED",
        snapshot,
      };
    }

    return {
      symbol: snapshot.symbol,
      status: snapshot.status,
      lifecycle: existing?.lifecycle || null,
      action: "WAITING_FOR_SETUP",
      snapshot,
    };
  }

  const initialized = await initializeLifecycle(snapshot);
  const updated = await updateLifecycle(snapshot, snapshot.price);
  await updatePublishedLifecycle(snapshot, updated.lifecycle);

  return {
    symbol: snapshot.symbol,
    status: snapshot.status,
    lifecycle: updated.lifecycle,
    action: initialized.existing ? "UPDATED" : "INITIALIZED",
    snapshot,
  };
}

async function runScan(symbols = null) {
  if (symbols === null) symbols = await getUniverse();

  if (!Array.isArray(symbols) || symbols.length === 0) {
    console.warn("⚠️ Scanner universe is empty; using default universe.");
    symbols = [...DEFAULT_UNIVERSE];
  }

  const originalCount = symbols.length;
  symbols = [...new Set(symbols)].slice(0, MAX_SCAN_SYMBOLS);

  if (originalCount > symbols.length) {
    console.log(`🎯 Scanner universe capped at ${MAX_SCAN_SYMBOLS}/${originalCount} symbols to stay within market-data rate limits.`);
  }

  scannerRuntime.lastStartedAt = new Date().toISOString();
  scannerRuntime.status = "SCANNING";
  scannerRuntime.lastError = null;
  scannerRuntime.persistenceDegraded = false;

  const results = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const snapshot = await scanSymbol(symbol);
          const result = await processSnapshot(snapshot);
          return { ...result, snapshot };
        } catch (error) {
          return {
            symbol,
            status: "ERROR",
            valid: false,
            lifecycle: null,
            action: "ERROR",
            reason: error.message || "Scan failed",
            snapshot: {
              symbol,
              price: null,
              status: "ERROR",
              valid: false,
              direction: null,
              entry: null,
              stop: null,
              targets: [],
              riskReward: null,
              quality: null,
              stage: "scanner",
              reason: error.message || "Scan failed",
              lifecycle: null,
              generatedAt: new Date().toISOString(),
              snapshotAt: new Date().toISOString(),
            },
          };
        }
      }),
    );

    results.push(...batchResults);
    console.log(`🔎 Scanner progress: ${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length}`);
  }

  // Keep the latest completed scan in process memory. This is the immediate
  // broadcast/read path and survives persistence hiccups without changing
  // authentication or execution rules.
  latestScanResults = results.map((result) => ({
    ...(result.snapshot || {}),
    symbol: result.symbol,
    status: result.snapshot?.status || result.status,
    valid: result.snapshot?.valid === true,
    lifecycle: result.lifecycle || result.snapshot?.lifecycle || null,
    reason: result.snapshot?.reason || result.reason || null,
  }));

  const signals = results
    .filter((result) => result.snapshot && result.snapshot.valid === true && result.snapshot.status === "READY")
    .map((result) => ({ ...result.snapshot, lifecycle: result.lifecycle || null }));

  try {
    if (signals.length > 0) {
      await publishScannerSnapshot(signals, {
        scannedSymbols: results.length,
        publishedSignals: signals.length,
      });
    } else {
      await refreshScannerSnapshot({
        scannedSymbols: results.length,
        publishedSignals: 0,
      });
    }

    await publishScannerReadModel(latestScanResults, {
      scannedSymbols: results.length,
      cycle: Date.now(),
    });
  } catch (error) {
    scannerRuntime.persistenceDegraded = true;
    scannerRuntime.lastError = error.message || String(error);
    console.error("⚠️ Scanner persistence unavailable; serving in-memory scan results:", error.stack || error.message || error);
  }

  const ready = results.filter((result) => result.status === "READY").length;
  const wait = results.filter((result) => result.status === "WAIT").length;
  const errors = results.filter((result) => result.status === "ERROR").length;

  scannerRuntime.status = "READY";
  scannerRuntime.lastCompletedAt = new Date().toISOString();
  scannerRuntime.scannedSymbols = results.length;
  scannerRuntime.ready = ready;
  scannerRuntime.wait = wait;
  scannerRuntime.errors = errors;

  return results;
}

function getLatestScanResults() {
  return latestScanResults.map((result) => ({ ...result }));
}

function getScannerRuntimeStatus() {
  return {
    ...scannerRuntime,
    running: scannerLoopRunning,
    intervalMinutes: SCAN_INTERVAL_MS / 60000,
    maxScanSymbols: MAX_SCAN_SYMBOLS,
    inMemoryResults: latestScanResults.length,
  };
}

function startScannerLoop() {
  if (scannerLoopRunning) {
    console.log("⏳ Scanner loop already running.");
    return;
  }

  scannerLoopRunning = true;
  scannerRuntime.status = "STARTING";
  scannerRuntime.startedAt = new Date().toISOString();

  console.log(`🔄 KitSetups scanner loop started — scanning up to ${MAX_SCAN_SYMBOLS} markets; next cycle ${SCAN_INTERVAL_MS / 60000} minutes after completion`);

  const runCycle = async () => {
    try {
      console.log("");
      console.log("🚀 KITSETUPS SCANNER CYCLE");

      const results = await runScan();
      const ready = results.filter((result) => result.status === "READY").length;
      const wait = results.filter((result) => result.status === "WAIT").length;
      const errors = results.filter((result) => result.status === "ERROR").length;

      console.log(`🏁 Cycle complete — ${results.length} scanned | ${ready} READY | ${wait} WAIT | ${errors} ERROR`);
    } catch (error) {
      scannerRuntime.status = "ERROR";
      scannerRuntime.lastError = error.message || String(error);
      scannerRuntime.lastCompletedAt = new Date().toISOString();
      console.error("❌ Scanner cycle failed:", error.stack || error.message || error);
    } finally {
      const nextCycleAt = new Date(Date.now() + SCAN_INTERVAL_MS);
      scannerRuntime.nextCycleAt = nextCycleAt.toISOString();
      console.log(`⏱️ Next scanner cycle in ${SCAN_INTERVAL_MS / 60000} minutes`);
      scannerLoopTimer = setTimeout(runCycle, SCAN_INTERVAL_MS);
    }
  };

  runCycle();
}

function stopScannerLoop() {
  if (scannerLoopTimer) {
    clearTimeout(scannerLoopTimer);
    scannerLoopTimer = null;
  }

  scannerLoopRunning = false;
  scannerRuntime.status = "STOPPED";
  console.log("🛑 KitSetups scanner loop stopped.");
}

module.exports = {
  processSnapshot,
  runScan,
  getLatestScanResults,
  getScannerRuntimeStatus,
  startScannerLoop,
  stopScannerLoop,
};
