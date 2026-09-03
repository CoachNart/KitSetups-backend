"use strict";

const { getUniverse, DEFAULT_UNIVERSE } = require("./universe");
const { scanSymbol } = require("./scanner");
const { publishScannerSnapshot, publishScannerReadModel } = require("./persistence");

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
  return {
    symbol: snapshot.symbol,
    status: snapshot.status,
    valid: snapshot.valid === true,
    lifecycle: snapshot.lifecycle || null,
    action: snapshot.status === "READY" ? "SCANNED" : "WAITING_FOR_SETUP",
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

  // Render's current instance is hitting Node's ~256 MB heap limit when five
  // symbols are analyzed simultaneously. Each symbol loads five 200-candle
  // datasets and builds multiple analysis structures. Analyze one symbol at a
  // time so peak memory stays bounded while retaining the full 40-market scan.
  const BATCH_SIZE = 1;

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

  latestScanResults = results.map((result) => ({
    ...(result.snapshot || {}),
    symbol: result.symbol,
    status: result.snapshot?.status || result.status,
    valid: result.snapshot?.valid === true,
    lifecycle: result.lifecycle || result.snapshot?.lifecycle || null,
    reason: result.snapshot?.reason || result.reason || null,
  }));

  const signals = latestScanResults.filter((result) => result.valid === true && result.status === "READY");

  try {
    await publishScannerSnapshot(signals, {
      scannedSymbols: results.length,
      publishedSignals: signals.length,
    });

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

module.exports = {
  runScan,
  startScannerLoop,
  getLatestScanResults,
  getScannerRuntimeStatus,
};
