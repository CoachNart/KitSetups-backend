"use strict";

const { db } = require("../services/firestore");

const COLLECTION = "lifecycle";

function ref(setupId) {
  if (!setupId) {
    throw new Error("setupId is required");
  }

  return db.collection(COLLECTION).doc(String(setupId));
}

async function saveLifecycle(setupId, lifecycle) {
  if (!lifecycle || typeof lifecycle !== "object") {
    throw new Error("lifecycle is required");
  }

  const saved = {
    ...lifecycle,
    setupId: String(setupId),
    updatedAt: new Date().toISOString(),
  };

  await ref(setupId).set(saved, { merge: true });

  return saved;
}

async function getLifecycle(setupId) {
  const snapshot = await ref(setupId).get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data();
}

async function deleteLifecycle(setupId) {
  await ref(setupId).delete();

  return true;
}

async function listLifecycles() {
  const snapshot = await db.collection(COLLECTION).get();

  const result = {};

  snapshot.forEach((doc) => {
    result[doc.id] = doc.data();
  });

  return result;
}

module.exports = {
  saveLifecycle,
  getLifecycle,
  deleteLifecycle,
  listLifecycles,
};
