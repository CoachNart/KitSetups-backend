"use strict";

const { getUniverse, DEFAULT_UNIVERSE } = require("./universe");
const { scanSymbol } = require("./scanner");
const { publishScannerSnapshot, publishScannerReadModel } = require("./persistence");

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
// Keep the Render instance comfortably below its memory ceiling. The scanner
// used to retain 40 full technical snapshots, which can exhaust a small Node
// instance even when symbols are processed sequentially.
const MAX_SCAN_SYMBOLS = 12;

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
    console.log(`🎯 Scanner universe capped at ${MAX_SCAN_SYMBOLS}/${originalCount} symbols to protect backend memory.`);
  }

  scannerRuntime.lastStartedAt = new Date().toISOString();
  scannerRuntime.status = "SCANNING";
  scannerRuntime.lastError = null;
  scannerRuntime.persistenceDegraded = false;

  const results = [];

  // Process strictly one market at a time. Do not accumulate concurrent
  // analysis jobs on the Render instance.
  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i];
    let result;

    try {
      const snapshot = await scanSymbol(symbol);
      result = await processSnapshot(snapshot);
    } catch (error) {
      result = {
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

    results.push(result);
    console.log(`🔎 Scanner progress: ${i + 1}/${symbols.length}`);

    // Give the event loop a chance to release transient buffers between
    // heavy technical-analysis jobs.
    await new Promise((resolve) => setTimeout(resolve, 25));
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
