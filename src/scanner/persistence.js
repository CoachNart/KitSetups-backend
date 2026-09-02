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

async function publishScannerSnapshot(signals, metadata = {}) {
  if (!Array.isArray(signals)) {
    throw new Error("signals must be an array");
  }

  const publishedAt = new Date().toISOString();

  for (const signal of signals) {
    if (
      !signal ||
      signal.valid !== true ||
      signal.status !== "READY" ||
      !signal.symbol
    ) {
      continue;
    }

    const identity = setupIdentity(signal);
    const legacyIdentity = legacySetupIdentity(signal);

    const existing = await db
      .collection(COLLECTION)
      .where("published", "==", true)
      .get();

    const existingDoc = existing.docs.find((doc) => {
      const data = doc.data() || {};
      return (
        data.setupIdentity === identity ||
        data.setupIdentity === legacyIdentity
      );
    });

    const signalId = existingDoc
      ? existingDoc.id
      : `ks_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const previous = existingDoc?.data() || {};

    await db
      .collection(COLLECTION)
      .doc(signalId)
      .set(
        {
          ...signal,
          signalId,
          setupIdentity: identity,
          published: true,
          publishedAt: previous.publishedAt || publishedAt,
          updatedAt: publishedAt,
        },
        { merge: true }
      );
  }

  const published = await db
    .collection(COLLECTION)
    .where("published", "==", true)
    .get();

  const activeSignals = published.docs
    .map((doc) => ({
      ...doc.data(),
      signalId: doc.data().signalId || doc.id,
    }))
    .filter((signal) => {
      const status =
        signal.lifecycle?.status ||
        signal.signalState ||
        signal.status;

      return (
        status === "READY" ||
        status === "ENTRY_HIT" ||
        status === "ACTIVE" ||
        status === "TP1_HIT" ||
        status === "TP2_HIT"
      );
    });

  const payload = {
    signals: activeSignals,
    scanner: {
      cycle: metadata.cycle ?? Date.now(),
      scannedSymbols: metadata.scannedSymbols ?? 0,
      publishedSignals: activeSignals.length,
      status: "READY",
      updatedAt: publishedAt,
    },
    updatedAt: publishedAt,
  };

  await db
    .collection(COLLECTION)
    .doc(DOCUMENT)
    .set(payload);

  return payload;
}

async function getPublishedSetupForSymbol(symbol) {
  if (!symbol) return null;

  const snapshot = await db
    .collection(COLLECTION)
    .where("published", "==", true)
    .get();

  const matches = snapshot.docs
    .map((doc) => ({
      ...doc.data(),
      signalId: doc.data().signalId || doc.id,
    }))
    .filter((signal) => {
      if (signal.symbol !== symbol) return false;

      const status =
        signal.lifecycle?.status ||
        signal.signalState ||
        signal.status;

      return (
        status === "READY" ||
        status === "ENTRY_HIT" ||
        status === "ACTIVE" ||
        status === "TP1_HIT" ||
        status === "TP2_HIT"
      );
    });

  return matches[0] || null;
}

async function updatePublishedLifecycle(signal, lifecycle) {
  if (!signal?.symbol || !lifecycle) return null;

  const identity = setupIdentity(signal);
  const legacyIdentity = legacySetupIdentity(signal);

  const snapshot = await db
    .collection(COLLECTION)
    .where("published", "==", true)
    .get();

  const existing = snapshot.docs.find((doc) => {
    const data = doc.data() || {};
    return (
      data.setupIdentity === identity ||
      data.setupIdentity === legacyIdentity ||
      (
        data.symbol === signal.symbol &&
        data.direction === signal.direction &&
        Number(data.entry) === Number(signal.entry) &&
        Number(data.stop) === Number(signal.stop)
      )
    );
  });

  if (!existing) return null;

  const now = new Date().toISOString();

  await existing.ref.set(
    {
      lifecycle,
      signalState: lifecycle.status || null,
      updatedAt: now,
    },
    { merge: true }
  );

  const published = await db
    .collection(COLLECTION)
    .where("published", "==", true)
    .get();

  const activeSignals = published.docs
    .map((doc) => ({
      ...doc.data(),
      signalId: doc.data().signalId || doc.id,
    }))
    .filter((signal) => {
      const status =
        signal.lifecycle?.status ||
        signal.signalState ||
        signal.status;

      return (
        status === "READY" ||
        status === "ENTRY_HIT" ||
        status === "ACTIVE" ||
        status === "TP1_HIT" ||
        status === "TP2_HIT"
      );
    });

  await db
    .collection(COLLECTION)
    .doc(DOCUMENT)
    .set(
      {
        signals: activeSignals,
        scanner: {
          status: "READY",
          publishedSignals: activeSignals.length,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

  return {
    ...existing.data(),
    lifecycle,
    signalState: lifecycle.status || null,
    updatedAt: now,
  };
}

async function getScannerSnapshot() {
  const snap = await db
    .collection(COLLECTION)
    .doc(DOCUMENT)
    .get();

  return snap.exists ? snap.data() : null;
}

module.exports = {
  publishScannerSnapshot,
  updatePublishedLifecycle,
  getPublishedSetupForSymbol,
  getScannerSnapshot,
};
