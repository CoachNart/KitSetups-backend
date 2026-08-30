const market = require("./src/tools/market");

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getDirection(signal) {
  const direction =
    signal?.tradePlan?.direction ??
    signal?.direction ??
    "";

  const value = String(direction).toUpperCase();

  if (value === "LONG" || value === "SHORT") {
    return value;
  }

  return null;
}

function getEntryRange(signal) {
  const plan = signal?.tradePlan || signal || {};

  const candidates = [
    plan.entry,
    plan.entryPrice,
    plan.entryZone,
    signal?.entry,
  ];

  for (const entry of candidates) {
    const direct = num(entry);

    if (direct !== null) {
      return {
        min: direct,
        max: direct,
      };
    }

    if (entry && typeof entry === "object") {
      const min =
        num(entry.min) ??
        num(entry.low) ??
        num(entry.start) ??
        num(entry.from);

      const max =
        num(entry.max) ??
        num(entry.high) ??
        num(entry.end) ??
        num(entry.to);

      if (min !== null || max !== null) {
        return {
          min: min ?? max,
          max: max ?? min,
        };
      }
    }
  }

  return {
    min: null,
    max: null,
  };
}

function getStopLoss(signal) {
  const plan = signal?.tradePlan || signal || {};

  return (
    num(plan.stopLoss) ??
    num(plan.sl) ??
    num(plan.stop) ??
    null
  );
}

function getTargets(signal) {
  const plan = signal?.tradePlan || signal || {};

  const raw =
    plan.targets ??
    plan.takeProfits ??
    plan.takeProfit ??
    plan.tp ??
    plan.target ??
    [];

  const values = Array.isArray(raw)
    ? raw
    : [raw];

  return values
    .map((target) => {
      if (
        target &&
        typeof target === "object"
      ) {
        return (
          num(target.price) ??
          num(target.target) ??
          num(target.value)
        );
      }

      return num(target);
    })
    .filter(
      (price) => price !== null
    );
}

function getLifecycle(signal) {
  const stored =
    signal?.lifecycle || {};

  return {
    status:
      stored.status ||
      signal?.signalState ||
      signal?.tradePlan?.lifecycleStatus ||
      signal?.tradePlan?.status ||
      "READY",

    entryHit:
      stored.entryHit === true,

    entryHitAt:
      stored.entryHitAt || null,

    stopLossHit:
      stored.stopLossHit === true,

    stopLossHitAt:
      stored.stopLossHitAt || null,

    outcome:
      stored.outcome || null,

    closedAt:
      stored.closedAt || null,

    lastPrice:
      num(stored.lastPrice),

    lastCheckedAt:
      stored.lastCheckedAt || null,

    targets:
      Array.isArray(stored.targets)
        ? stored.targets
        : [],

    highestPrice:
      num(stored.highestPrice),

    lowestPrice:
      num(stored.lowestPrice),

    checks:
      Number(stored.checks) || 0,
  };
}

function priceInRange(
  price,
  min,
  max
) {
  if (
    price === null ||
    min === null ||
    max === null
  ) {
    return false;
  }

  return (
    price >= Math.min(min, max) &&
    price <= Math.max(min, max)
  );
}

function crossedEntry(
  direction,
  previousPrice,
  currentPrice,
  min,
  max
) {
  if (
    previousPrice === null ||
    currentPrice === null ||
    min === null ||
    max === null
  ) {
    return false;
  }

  const low =
    Math.min(min, max);

  const high =
    Math.max(min, max);

  if (direction === "LONG") {
    return (
      previousPrice < low &&
      currentPrice >= low
    ) || (
      previousPrice < high &&
      currentPrice >= high
    );
  }

  if (direction === "SHORT") {
    return (
      previousPrice > high &&
      currentPrice <= high
    ) || (
      previousPrice > low &&
      currentPrice <= low
    );
  }

  return false;
}

function reachedTarget(
  direction,
  price,
  target
) {
  if (
    price === null ||
    target === null
  ) {
    return false;
  }

  if (direction === "LONG") {
    return price >= target;
  }

  if (direction === "SHORT") {
    return price <= target;
  }

  return false;
}

function hitStop(
  direction,
  price,
  stopLoss
) {
  if (
    price === null ||
    stopLoss === null
  ) {
    return false;
  }

  if (direction === "LONG") {
    return price <= stopLoss;
  }

  if (direction === "SHORT") {
    return price >= stopLoss;
  }

  return false;
}

function validateGeometry(
  direction,
  entry,
  stopLoss,
  targets
) {
  if (
    !direction ||
    entry.min === null ||
    entry.max === null ||
    stopLoss === null ||
    !targets.length
  ) {
    return false;
  }

  const entryMid =
    (
      entry.min +
      entry.max
    ) / 2;

  if (direction === "LONG") {
    if (!(stopLoss < entryMid)) {
      return false;
    }

    return targets.every(
      target =>
        target > entryMid
    );
  }

  if (direction === "SHORT") {
    if (!(stopLoss > entryMid)) {
      return false;
    }

    return targets.every(
      target =>
        target < entryMid
    );
  }

  return false;
}

async function getCurrentPrice(symbol) {
  if (
    typeof market.getPrice ===
    "function"
  ) {
    return num(
      await market.getPrice(symbol)
    );
  }

  if (
    typeof market.getTicker ===
    "function"
  ) {
    const ticker =
      await market.getTicker(symbol);

    return num(
      ticker?.lastPrice ??
      ticker?.price ??
      ticker?.last
    );
  }

  throw new Error(
    "market.js needs getPrice() or getTicker() for lifecycle tracking"
  );
}

function buildTargets(
  direction,
  targets,
  previousTargets,
  entryHit,
  price,
  now
) {
  return targets.map(
    (target, index) => {
      const previous =
        previousTargets[index] ||
        {};

      const alreadyHit =
        previous.hit === true;

      const hit =
        alreadyHit ||
        (
          entryHit &&
          reachedTarget(
            direction,
            price,
            target
          )
        );

      return {
        index: index + 1,
        price: target,
        hit,
        hitAt: hit
          ? (
              previous.hitAt ||
              now
            )
          : null,
      };
    }
  );
}

function countTargetsHit(
  targets
) {
  return targets.filter(
    target => target.hit === true
  ).length;
}

function getFirstUnhitTarget(
  targets
) {
  return targets.find(
    target =>
      target.hit !== true
  ) || null;
}

async function evaluateSignal(
  signal
) {
  const direction =
    getDirection(signal);

  const lifecycle =
    getLifecycle(signal);

  /*
   * CLOSED STATES ARE IMMUTABLE.
   *
   * Once the trade has reached a terminal
   * outcome, later scans must never reopen it.
   */
  const terminalStates = [
    "TP_HIT",
    "STOP_LOSS",
    "MISSED",
    "EXPIRED",
  ];

  if (
    terminalStates.includes(
      lifecycle.status
    )
  ) {
    return lifecycle;
  }

  if (
    !signal?.symbol ||
    !direction
  ) {
    return lifecycle;
  }

  const price =
    await getCurrentPrice(
      signal.symbol
    );

  if (price === null) {
    return {
      ...lifecycle,
      lastCheckedAt:
        new Date().toISOString(),
    };
  }

  const entry =
    getEntryRange(signal);

  const stopLoss =
    getStopLoss(signal);

  const targets =
    getTargets(signal);

  const now =
    new Date().toISOString();

  const previousPrice =
    num(lifecycle.lastPrice);

  /*
   * Track excursion statistics.
   *
   * Useful later for analytics:
   * MAE / MFE / setup performance.
   */
  const highestPrice =
    lifecycle.highestPrice === null
      ? price
      : Math.max(
          lifecycle.highestPrice,
          price
        );

  const lowestPrice =
    lifecycle.lowestPrice === null
      ? price
      : Math.min(
          lifecycle.lowestPrice,
          price
        );

  const currentlyInEntry =
    priceInRange(
      price,
      entry.min,
      entry.max
    );

  const entryWasCrossed =
    crossedEntry(
      direction,
      previousPrice,
      price,
      entry.min,
      entry.max
    );

  const entryTriggered =
    currentlyInEntry ||
    entryWasCrossed;

  /*
   * Detect invalid trade geometry.
   *
   * We do not mutate a valid lifecycle into
   * a fake result because of malformed levels.
   */
  const geometryValid =
    validateGeometry(
      direction,
      entry,
      stopLoss,
      targets
    );

  const next = {
    ...lifecycle,

    lastPrice:
      price,

    lastCheckedAt:
      now,

    highestPrice,

    lowestPrice,

    checks:
      lifecycle.checks + 1,

    targets:
      buildTargets(
        direction,
        targets,
        lifecycle.targets,
        lifecycle.entryHit,
        price,
        now
      ),
  };

  /*
   * ---------------------------------------------------------
   * ENTRY CONFIRMATION
   * ---------------------------------------------------------
   */
  if (
    !next.entryHit &&
    entryTriggered
  ) {
    next.entryHit = true;
    next.entryHitAt = now;
    next.status = "ACTIVE";

    console.log(
      `🎯 ENTRY HIT ${signal.symbol} ${direction}` +
      ` | ${previousPrice ?? "?"} → ${price}`
    );
  }

  /*
   * ---------------------------------------------------------
   * PRE-ENTRY STATE
   * ---------------------------------------------------------
   */
  if (!next.entryHit) {
    /*
     * If geometry is invalid, keep the setup
     * visible but do not invent a lifecycle event.
     */
    if (!geometryValid) {
      next.status = "READY";

      return next;
    }

    /*
     * MISSED
     *
     * If price reaches the first target before
     * touching entry, the setup is gone.
     */
    const firstTarget =
      targets[0];

    if (
      firstTarget !== undefined &&
      reachedTarget(
        direction,
        price,
        firstTarget
      )
    ) {
      next.status = "MISSED";
      next.outcome = "MISSED";
      next.closedAt = now;

      console.log(
        `⏭️ MISSED ${signal.symbol} ${direction}` +
        ` | price=${price}` +
        ` | firstTP=${firstTarget}`
      );

      return next;
    }

    /*
     * EXPIRED / INVALIDATED
     *
     * Price hit the protective level before
     * the entry was triggered.
     */
    if (
      stopLoss !== null &&
      hitStop(
        direction,
        price,
        stopLoss
      )
    ) {
      next.status = "EXPIRED";
      next.outcome = "INVALIDATED";
      next.closedAt = now;

      console.log(
        `⌛ EXPIRED ${signal.symbol} ${direction}` +
        ` | price=${price}` +
        ` | invalidation=${stopLoss}`
      );

      return next;
    }

    next.status = "READY";

    return next;
  }

  /*
   * ---------------------------------------------------------
   * ACTIVE TRADE
   * ---------------------------------------------------------
   */

  /*
   * STOP LOSS HAS PRIORITY OVER TARGETS.
   *
   * If both levels are theoretically crossed between
   * scanner checks, we cannot know intrabar order from
   * ticker snapshots alone. Conservative lifecycle logic
   * therefore protects the account by treating SL as hit.
   */
  if (
    stopLoss !== null &&
    hitStop(
      direction,
      price,
      stopLoss
    )
  ) {
    next.status = "STOP_LOSS";
    next.stopLossHit = true;
    next.stopLossHitAt =
      lifecycle.stopLossHitAt ||
      now;
    next.outcome = "STOP_LOSS";
    next.closedAt =
      lifecycle.closedAt ||
      now;

    console.log(
      `🛑 STOP LOSS ${signal.symbol} ${direction}` +
      ` | price=${price}` +
      ` | SL=${stopLoss}`
    );

    return next;
  }

  /*
   * Re-evaluate target hits using the current
   * active state.
   */
  next.targets =
    buildTargets(
      direction,
      targets,
      lifecycle.targets,
      true,
      price,
      now
    );

  const targetsHit =
    countTargetsHit(
      next.targets
    );

  /*
   * If one or more targets were hit, log
   * partial progress but keep the trade active
   * until every configured target is reached.
   */
  const newlyHit =
    next.targets.filter(
      (target, index) =>
        target.hit === true &&
        !(
          lifecycle.targets[index]?.hit ===
          true
        )
    );

  for (
    const target of newlyHit
  ) {
    console.log(
      `💰 TP${target.index} HIT ${signal.symbol}` +
      ` | ${direction}` +
      ` | target=${target.price}` +
      ` | ${targetsHit}/${next.targets.length}`
    );
  }

  const allTargetsHit =
    next.targets.length > 0 &&
    next.targets.every(
      target =>
        target.hit === true
    );

  if (allTargetsHit) {
    next.status = "TP_HIT";
    next.outcome = "TP_HIT";
    next.closedAt =
      lifecycle.closedAt ||
      now;

    console.log(
      `🏆 ALL TARGETS HIT ${signal.symbol}` +
      ` | ${direction}`
    );

    return next;
  }

  /*
   * Active trade remains active after partial
   * target completion.
   */
  next.status = "ACTIVE";

  /*
   * Useful diagnostic metadata.
   */
  const nextTarget =
    getFirstUnhitTarget(
      next.targets
    );

  next.nextTarget =
    nextTarget?.price ??
    null;

  next.targetsHit =
    targetsHit;

  next.totalTargets =
    next.targets.length;

  return next;
}

module.exports = {
  evaluateSignal,
};
