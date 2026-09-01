"use strict";

const {
  STATES,
} = require("./state");

const {
  trackSetup,
} = require("./tracker");

const {
  saveLifecycle,
  getLifecycle,
} = require("./persistence");

function validPrice(price) {
  return (
    Number.isFinite(Number(price)) &&
    Number(price) > 0
  );
}

function validSetup(setup) {
  return (
    setup &&
    typeof setup === "object" &&
    typeof setup.symbol === "string" &&
    setup.valid === true &&
    (setup.direction === "LONG" ||
      setup.direction === "SHORT") &&
    validPrice(setup.entry) &&
    validPrice(setup.stop) &&
    Array.isArray(setup.targets)
  );
}

function setupId(setup) {
  if (setup.id) {
    return String(setup.id);
  }

  return [
    setup.symbol,
    setup.direction,
    setup.entry,
    setup.generatedAt || "",
  ].join(":");
}

function createLifecycle(setup) {
  if (!validSetup(setup)) {
    throw new Error(
      "valid READY setup is required"
    );
  }

  return {
    status: STATES.READY,

    entryHit: false,
    entryHitAt: null,

    targets: setup.targets.map(
      (target) => ({
        index: target.index,
        price: Number(target.price),
        hit: false,
        hitAt: null,
      })
    ),

    stopLossHit: false,
    stopLossHitAt: null,

    outcome: null,
    closedAt: null,

    lastPrice:
      Number(setup.price),

    lastCheckedAt:
      new Date().toISOString(),
  };
}

async function initializeLifecycle(setup) {
  if (!validSetup(setup)) {
    throw new Error(
      "valid READY setup is required"
    );
  }

  const id =
    setupId(setup);

  const existing =
    await getLifecycle(id);

  if (existing) {
    return {
      id,
      lifecycle: existing,
      existing: true,
    };
  }

  const lifecycle =
    createLifecycle(setup);

  const saved =
    await saveLifecycle(
      id,
      lifecycle
    );

  return {
    id,
    lifecycle: saved,
    existing: false,
  };
}

async function updateLifecycle(
  setup,
  currentPrice
) {
  if (!validSetup(setup)) {
    throw new Error(
      "valid READY setup is required"
    );
  }

  if (!validPrice(currentPrice)) {
    throw new Error(
      "valid current price is required"
    );
  }

  const id =
    setupId(setup);

  const stored =
    await getLifecycle(id);

  const lifecycle =
    stored ||
    createLifecycle(setup);

  const tracked =
    trackSetup(
      {
        ...setup,
        lifecycle,
      },
      currentPrice
    );

  const saved =
    await saveLifecycle(
      id,
      tracked
    );

  return {
    id,
    lifecycle: saved,
  };
}

module.exports = {
  validSetup,
  setupId,
  createLifecycle,
  initializeLifecycle,
  updateLifecycle,
};
