"use strict";

const { getUniverse } = require("./universe");
const { scanSymbol } = require("./scanner");
const {
  initializeLifecycle,
  updateLifecycle,
} = require("../lifecycle/service");
const {
  publishScannerSnapshot,
} = require("./persistence");

async function processSnapshot(snapshot) {
  if (!snapshot) {
    throw new Error("snapshot is required");
  }

  if (
    snapshot.status !== "READY" ||
    snapshot.valid !== true
  ) {
    return {
      symbol: snapshot.symbol,
      status: snapshot.status,
      lifecycle: null,
      action: "IGNORED",
      snapshot,
    };
  }

  const initialized =
    await initializeLifecycle(snapshot);

  const updated =
    await updateLifecycle(
      snapshot,
      snapshot.price
    );

  return {
    symbol: snapshot.symbol,
    status: snapshot.status,
    lifecycle: updated.lifecycle,
    action: initialized.existing
      ? "UPDATED"
      : "INITIALIZED",
    snapshot,
  };
}

async function runScan(
  symbols = null
) {
  if (symbols === null) {
    symbols = await getUniverse();
  }
  if (!Array.isArray(symbols)) {
    throw new Error("symbols must be an array");
  }

  const results = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const snapshot =
            await scanSymbol(symbol);

          const result =
            await processSnapshot(snapshot);

          return {
            ...result,
            snapshot,
          };
        } catch (error) {
          return {
            symbol,
            status: "ERROR",
            lifecycle: null,
            action: "ERROR",
            reason:
              error.message ||
              "Scan failed",
          };
        }
      })
    );

    results.push(...batchResults);

    console.log(
      `🔎 Scanner progress: ${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length}`
    );
  }

  const signals = results
    .filter(
      (result) =>
        result.snapshot &&
        result.snapshot.valid === true &&
        result.snapshot.status === "READY"
    )
    .map((result) => ({
      ...result.snapshot,
      lifecycle:
        result.lifecycle || null,
    }));

  /*
   * Never erase published signals because the current scan
   * produced WAIT/ERROR results.
   *
   * An empty READY set is not a destructive event.
   */
  if (signals.length > 0) {
    await publishScannerSnapshot(signals, {
      scannedSymbols: results.length,
      publishedSignals: signals.length,
    });
  }

  return results;
}

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

let scannerLoopRunning = false;
let scannerLoopTimer = null;

function startScannerLoop() {
  if (scannerLoopRunning) {
    console.log("⏳ Scanner loop already running.");
    return;
  }

  scannerLoopRunning = true;

  console.log(
    `🔄 KitSetups scanner loop started — ` +
    `next cycle ${SCAN_INTERVAL_MS / 60000} minutes after completion`
  );

  const runCycle = async () => {
    try {
      console.log("");
      console.log("🚀 KITSETUPS SCANNER CYCLE");

      const results = await runScan();

      const ready = results.filter(
        (result) =>
          result.status === "READY"
      ).length;

      const wait = results.filter(
        (result) =>
          result.status === "WAIT"
      ).length;

      const errors = results.filter(
        (result) =>
          result.status === "ERROR"
      ).length;

      console.log(
        `🏁 Cycle complete — ` +
        `${results.length} scanned | ` +
        `${ready} READY | ` +
        `${wait} WAIT | ` +
        `${errors} ERROR`
      );
    } catch (error) {
      console.error(
        "❌ Scanner cycle failed:",
        error.stack || error.message || error
      );
    } finally {
      console.log(
        `⏱️ Next scanner cycle in ` +
        `${SCAN_INTERVAL_MS / 60000} minutes`
      );

      scannerLoopTimer = setTimeout(
        runCycle,
        SCAN_INTERVAL_MS
      );
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

  console.log("🛑 KitSetups scanner loop stopped.");
}

module.exports = {
  processSnapshot,
  runScan,
  startScannerLoop,
  stopScannerLoop,
};
