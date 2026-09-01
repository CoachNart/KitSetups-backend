"use strict";

const { db } = require("../services/firestore");

const COLLECTION = "signals";
const DOCUMENT = "latest";

async function publishScannerSnapshot(
  signals,
  metadata = {}
) {
  if (!Array.isArray(signals)) {
    throw new Error("signals must be an array");
  }

  if (signals.length === 0) {
    return null;
  }

  const payload = {
    signals,
    scanner: {
      cycle:
        metadata.cycle ??
        Date.now(),

      scannedSymbols:
        metadata.scannedSymbols ??
        0,

      publishedSignals:
        metadata.publishedSignals ??
        signals.length,

      status: "READY",

      updatedAt:
        new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  await db
    .collection(COLLECTION)
    .doc(DOCUMENT)
    .set(payload, { merge: true });

  return payload;
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
  getScannerSnapshot,
};
