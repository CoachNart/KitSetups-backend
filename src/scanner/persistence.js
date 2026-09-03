"use strict";

const crypto = require("crypto");
const { db } = require("../services/firestore");

const COLLECTION = "signals";
const DOCUMENT = "latest";

function setupIdentity(signal) {
  return [signal.symbol, signal.direction, signal.entry, signal.stop, signal.targets?.[0]?.price].join("|");
}

function stableSignalId(signal) {
  return `ks_${crypto.createHash("sha1").update(setupIdentity(signal)).digest("hex").slice(0, 20)}`;
}

function isLiveLifecycleSignal(signal) {
  const status = signal.lifecycle?.status || signal.signalState || signal.status;
  return ["READY", "ENTRY_HIT", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(status);
}

async function writeScannerSnapshot(activeSignals, metadata = {}, options = {}) {
  const now = new Date().toISOString();
  const latestRef = db.collection(COLLECTION).doc(DOCUMENT);
  const payload = {
    ...(options.previous || {}),
    signals: activeSignals,
    scanResults: Array.isArray(options.scanResults) ? options.scanResults : activeSignals,
    scanner: {
      ...(options.previous?.scanner || {}),
      cycle: metadata.cycle ?? options.previous?.scanner?.cycle ?? Date.now(),
      scannedSymbols: metadata.scannedSymbols ?? options.previous?.scanner?.scannedSymbols ?? 0,
      publishedSignals: activeSignals.length,
      status: activeSignals.length > 0 ? "READY" : "WAITING",
      updatedAt: now,
    },
    updatedAt: now,
  };

  await latestRef.set(payload, { merge: false });
  return payload;
}

async function publishScannerSnapshot(signals, metadata = {}) {
  if (!Array.isArray(signals)) throw new Error("signals must be an array");

  // IMPORTANT: this hot path performs zero Firestore reads. The previous
  // implementation queried the entire published-signals collection every
  // scanner cycle just to discover document IDs. Stable IDs make that query
  // unnecessary and eliminate RESOURCE_EXHAUSTED read failures.
  const publishedAt = new Date().toISOString();
  const batch = db.batch();
  const activeSignals = [];

  for (const signal of signals) {
    if (!signal || signal.valid !== true || signal.status !== "READY" || !signal.symbol) continue;

    const signalId = stableSignalId(signal);
    const payload = {
      ...signal,
      signalId,
      setupIdentity: setupIdentity(signal),
      published: true,
      publishedAt: signal.publishedAt || publishedAt,
      updatedAt: publishedAt,
    };

    batch.set(db.collection(COLLECTION).doc(signalId), payload, { merge: true });
    activeSignals.push(payload);
  }

  if (activeSignals.length > 0) await batch.commit();

  return writeScannerSnapshot(activeSignals, metadata, { scanResults: activeSignals });
}

async function publishScannerReadModel(scanResults, metadata = {}) {
  if (!Array.isArray(scanResults)) throw new Error("scanResults must be an array");

  const now = new Date().toISOString();
  const safeResults = scanResults.filter(Boolean).map((result) => ({ ...result }));
  const readyCount = safeResults.filter((result) => result.status === "READY" && result.valid === true).length;

  // No read-before-write. The completed scanner result is already held in
  // memory by runner.js, so overwrite the single read-model document directly.
  const payload = {
    signals: safeResults,
    scanResults: safeResults,
    scanner: {
      cycle: metadata.cycle ?? Date.now(),
      scannedSymbols: metadata.scannedSymbols ?? safeResults.length,
      publishedSignals: readyCount,
      readySignals: readyCount,
      waitSignals: safeResults.filter((result) => result.status === "WAIT").length,
      errorSignals: safeResults.filter((result) => result.status === "ERROR").length,
      status: readyCount > 0 ? "READY" : "WAITING",
      updatedAt: now,
    },
    updatedAt: now,
  };

  await db.collection(COLLECTION).doc(DOCUMENT).set(payload, { merge: false });
  return payload;
}

async function refreshScannerSnapshot(metadata = {}) {
  // Kept for compatibility with callers outside the scanner runner. Avoid a
  // collection query; there is no reason to rebuild a snapshot from Firestore
  // on the scanner hot path.
  return writeScannerSnapshot([], metadata);
}

async function getPublishedSetupForSymbol(symbol) {
  if (!symbol) return null;
  const snapshot = await db.collection(COLLECTION).doc(DOCUMENT).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  const signals = Array.isArray(data.signals) ? data.signals : [];
  return signals.find((signal) => signal.symbol === symbol && isLiveLifecycleSignal(signal)) || null;
}

async function updatePublishedLifecycle(signal, lifecycle) {
  if (!signal?.symbol || !lifecycle) return null;

  // Stable signal IDs let lifecycle updates target one document directly.
  // No collection scan is needed.
  const signalId = signal.signalId || stableSignalId(signal);
  const now = new Date().toISOString();
  const ref = db.collection(COLLECTION).doc(signalId);
  await ref.set({ lifecycle, signalState: lifecycle.status || null, updatedAt: now }, { merge: true });
  return { ...signal, lifecycle, signalState: lifecycle.status || null, updatedAt: now };
}

async function getScannerSnapshot() {
  const snap = await db.collection(COLLECTION).doc(DOCUMENT).get();
  return snap.exists ? snap.data() : null;
}

module.exports = {
  publishScannerSnapshot,
  publishScannerReadModel,
  refreshScannerSnapshot,
  updatePublishedLifecycle,
  getPublishedSetupForSymbol,
  getScannerSnapshot,
};
