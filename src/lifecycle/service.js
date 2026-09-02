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
    setup.stop,
    setup.targets?.[0]?.price,
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

async function findLifecycle(setup) {
  const id = setupId(setup);

  const stable = await getLifecycle(id);

  const legacyPrefix = [
    setup.symbol,
    setup.direction,
    setup.entry,
  ].join(":") + ":";

  let legacy = null;

  const lifecycleRecords =
    await require("./persistence").listLifecycles();

  for (const [recordId, record] of Object.entries(lifecycleRecords)) {
    if (!recordId.startsWith(legacyPrefix)) {
      continue;
    }

    if (recordId === id) {
      continue;
    }

    if (
      !legacy ||
      record.status === STATES.MISSED ||
      record.status === STATES.CLOSED ||
      record.status === STATES.STOP_LOSS
    ) {
      legacy = record;
    }
  }

  if (
    stable &&
    legacy &&
    (
      legacy.status === STATES.MISSED ||
      legacy.status === STATES.CLOSED ||
      legacy.status === STATES.STOP_LOSS
    ) &&
    stable.status !== legacy.status
  ) {
    const migrated =
      await saveLifecycle(id, legacy);

    return {
      id,
      lifecycle: migrated,
      existing: true,
      migrated: true,
    };
  }

  if (stable) {
    return {
      id,
      lifecycle: stable,
      existing: true,
      migrated: false,
    };
  }

  if (legacy) {
    const migrated =
      await saveLifecycle(id, legacy);

    return {
      id,
      lifecycle: migrated,
      existing: true,
      migrated: true,
    };
  }

  return {
    id,
    lifecycle: null,
    existing: false,
    migrated: false,
  };
}

async function initializeLifecycle(setup) {
  if (!validSetup(setup)) {
    throw new Error(
      "valid READY setup is required"
    );
  }

  const found =
    await findLifecycle(setup);

  if (found.lifecycle) {
    return found;
  }

  const lifecycle =
    createLifecycle(setup);

  const saved =
    await saveLifecycle(
      found.id,
      lifecycle
    );

  return {
    id: found.id,
    lifecycle: saved,
    existing: false,
    migrated: false,
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

  const found =
    await findLifecycle(setup);

  const id = found.id;

  const lifecycle =
    found.lifecycle ||
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
