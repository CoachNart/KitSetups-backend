"use strict";

const { randomUUID } = require("crypto");
const { db } = require("../services/firestore");

const COLLECTION = "signals";
const DOCUMENT = "latest";

function setupIdentity(signal) {
  return [
    signal.direction,
    signal.entry,
    signal.stop,
    signal.targets?.[0]?.price,
  ].join("|");
}

function legacySetupIdentity(signal) {
  return [
    signal.symbol,
    signal.direction,
    signal.entry,
    signal.stop,
    signal.targets?.[0]?.price,
  ].join("|");
}

function isLiveLifecycleSignal(signal) {
  const status = signal.lifecycle?.status || signal.signalState || signal.status;
  return ["READY", "ENTRY_HIT", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(status);
}

async function getPublishedActiveSignals() {
  const published = await db.collection(COLLECTION).where("published", "==", true).get();
  return published.docs
    .map((doc) => ({ ...doc.data(), signalId: doc.data().signalId || doc.id }))
    .filter(isLiveLifecycleSignal);
}

async function writeScannerSnapshot(activeSignals, metadata = {}, options = {}) {
  const now = new Date().toISOString();
  const latestRef = db.collection(COLLECTION).doc(DOCUMENT);
  let existing = options.previous ? { ...options.previous } : {};

  if (!options.merge) {
    const current = await latestRef.get();
    if (current.exists) existing = current.data() || {};
  }

  const payload = {
    ...existing,
    signals: activeSignals,
    scanResults: Array.isArray(existing.scanResults) ? existing.scanResults : [],
    scanner: {
      ...(existing.scanner || {}),
      cycle: metadata.cycle ?? existing.scanner?.cycle ?? Date.now(),
      scannedSymbols: metadata.scannedSymbols ?? existing.scanner?.scannedSymbols ?? 0,
      publishedSignals: activeSignals.length,
      status: activeSignals.length > 0 ? "READY" : "WAITING",
      updatedAt: now,
    },
    updatedAt: now,
  };

  await latestRef.set(payload, { merge: Boolean(options.merge) });
  return payload;
}

async function publishScannerSnapshot(signals, metadata = {}) {
  if (!Array.isArray(signals)) throw new Error("signals must be an array");

  const publishedAt = new Date().toISOString();

  for (const signal of signals) {
    if (!signal || signal.valid !== true || signal.status !== "READY" || !signal.symbol) continue;

    const identity = setupIdentity(signal);
    const legacyIdentity = legacySetupIdentity(signal);
    const existing = await db.collection(COLLECTION).where("published", "==", true).get();
    const existingDoc = existing.docs.find((doc) => {
      const data = doc.data() || {};
      return data.setupIdentity === identity || data.setupIdentity === legacyIdentity;
    });

    const signalId = existingDoc ? existingDoc.id : `ks_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const previous = existingDoc?.data() || {};

    await db.collection(COLLECTION).doc(signalId).set(
      {
        ...signal,
        signalId,
        setupIdentity: identity,
        published: true,
        publishedAt: previous.publishedAt || publishedAt,
        updatedAt: publishedAt,
      },
      { merge: true },
    );
  }

  return writeScannerSnapshot(await getPublishedActiveSignals(), metadata);
}

async function publishScannerReadModel(scanResults, metadata = {}) {
  if (!Array.isArray(scanResults)) throw new Error("scanResults must be an array");

  const now = new Date().toISOString();
  const safeResults = scanResults
    .filter(Boolean)
    .map((result) => ({ ...result }));

  const readyCount = safeResults.filter(
    (result) => result.status === "READY" && result.valid === true,
  ).length;

  const latestRef = db.collection(COLLECTION).doc(DOCUMENT);
  const current = await latestRef.get();
  const previous = current.exists ? current.data() || {} : {};

  const payload = {
    ...previous,
    scanResults: safeResults,
    signals: safeResults,
    scanner: {
      ...(previous.scanner || {}),
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

  await latestRef.set(payload, { merge: false });
  return payload;
}

async function refreshScannerSnapshot(metadata = {}) {
  return writeScannerSnapshot(await getPublishedActiveSignals(), metadata);
}

async function getPublishedSetupForSymbol(symbol) {
  if (!symbol) return null;

  const snapshot = await db.collection(COLLECTION).where("published", "==", true).get();
  return snapshot.docs
    .map((doc) => ({ ...doc.data(), signalId: doc.data().signalId || doc.id }))
    .filter((signal) => signal.symbol === symbol)
    .filter(isLiveLifecycleSignal)[0] || null;
}

async function updatePublishedLifecycle(signal, lifecycle) {
  if (!signal?.symbol || !lifecycle) return null;

  const identity = setupIdentity(signal);
  const legacyIdentity = legacySetupIdentity(signal);
  const snapshot = await db.collection(COLLECTION).where("published", "==", true).get();
  const existing = snapshot.docs.find((doc) => {
    const data = doc.data() || {};
    return (
      data.setupIdentity === identity ||
      data.setupIdentity === legacyIdentity ||
      (data.symbol === signal.symbol && data.direction === signal.direction && Number(data.entry) === Number(signal.entry) && Number(data.stop) === Number(signal.stop))
    );
  });

  if (!existing) return null;

  const now = new Date().toISOString();
  await existing.ref.set({ lifecycle, signalState: lifecycle.status || null, updatedAt: now }, { merge: true });
  await writeScannerSnapshot(await getPublishedActiveSignals(), { publishedSignals: (await getPublishedActiveSignals()).length }, { merge: true });

  return { ...existing.data(), lifecycle, signalState: lifecycle.status || null, updatedAt: now };
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
