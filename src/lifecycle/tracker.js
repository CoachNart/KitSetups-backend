"use strict";

const {
  STATES,
  canTransition,
} = require("./state");

function validPrice(price) {
  return Number.isFinite(Number(price)) && Number(price) > 0;
}

function trackSetup(setup, currentPrice) {
  if (!setup || typeof setup !== "object") {
    throw new Error("setup is required");
  }

  if (!validPrice(currentPrice)) {
    throw new Error("valid current price is required");
  }

  const price = Number(currentPrice);
  const direction = setup.direction;

  if (direction !== "LONG" && direction !== "SHORT") {
    throw new Error("valid setup direction is required");
  }

  const lifecycle = setup.lifecycle || {};
  const currentState = lifecycle.status || STATES.READY;

  if (!Object.values(STATES).includes(currentState)) {
    throw new Error(`Invalid lifecycle state: ${currentState}`);
  }

  const now = new Date().toISOString();

  const next = {
    ...lifecycle,
    lastPrice: price,
    lastCheckedAt: now,
  };

  const isLong = direction === "LONG";

  /*
   * ----------------------------------------------------------
   * TERMINAL STATES
   * ----------------------------------------------------------
   */

  if (currentState === STATES.MISSED) {
    return next;
  }

  if (currentState === STATES.CLOSED) {
    return next;
  }

  /*
   * ----------------------------------------------------------
   * TP3 / STOP LOSS → CLOSED
   * ----------------------------------------------------------
   */

  if (currentState === STATES.TP3_HIT) {
    if (canTransition(STATES.TP3_HIT, STATES.CLOSED)) {
      next.status = STATES.CLOSED;
      next.outcome = next.outcome || "WIN";
      next.closedAt = next.closedAt || now;
    }

    return next;
  }

  if (currentState === STATES.STOP_LOSS) {
    if (canTransition(STATES.STOP_LOSS, STATES.CLOSED)) {
      next.status = STATES.CLOSED;
      next.outcome = next.outcome || "LOSS";
      next.closedAt = next.closedAt || now;
    }

    return next;
  }

  /*
   * ----------------------------------------------------------
   * STOP LOSS
   * ----------------------------------------------------------
   */

  const stop = Number(setup.stop);

  if (validPrice(stop)) {
    const stopHit = isLong
      ? price <= stop
      : price >= stop;

    if (
      stopHit &&
      canTransition(currentState, STATES.STOP_LOSS)
    ) {
      next.status = STATES.STOP_LOSS;
      next.stopLossHit = true;
      next.stopLossHitAt =
        next.stopLossHitAt || now;
      next.outcome = "LOSS";

      return next;
    }
  }

  /*
   * ----------------------------------------------------------
   * READY
   * ----------------------------------------------------------
   *
   * READY means:
   * - setup passed all trade requirements
   * - setup was published
   * - entry has NOT triggered yet
   *
   * Therefore:
   *
   * entry reached  → ACTIVE
   * TP1 reached first → MISSED
   */

  if (currentState === STATES.READY) {
    const entry = Number(setup.entry);

    const targets = Array.isArray(setup.targets)
      ? setup.targets
      : [];

    const firstTarget = targets.find(
      (target) =>
        target &&
        validPrice(target.price)
    );

    /*
     * Entry is actionable only while price is
     * between entry and TP1.
     *
     * If price jumps beyond TP1 without an entry
     * trigger, the opportunity is MISSED.
     */

    if (validPrice(entry)) {
      /*
       * PRE-ENTRY INVALIDATION
       *
       * The stop/invalidation level is only a real
       * STOP_LOSS after entry has triggered.
       *
       * While READY, reaching that level means the
       * published opportunity failed before execution.
       * Therefore:
       *
       * READY -> MISSED
       *
       * This must happen before entry/target evaluation.
       */
      const invalidatedBeforeEntry = validPrice(stop)
        ? (
            isLong
              ? price <= stop
              : price >= stop
          )
        : false;

      if (
        invalidatedBeforeEntry &&
        canTransition(
          STATES.READY,
          STATES.MISSED
        )
      ) {
        next.status = STATES.MISSED;
        next.outcome = "MISSED";
        next.closedAt = next.closedAt || now;

        return next;
      }

      const entryHit = isLong
        ? price >= entry
        : price <= entry;

      const targetReached = firstTarget
        ? (
            isLong
              ? price >= Number(firstTarget.price)
              : price <= Number(firstTarget.price)
          )
        : false;

      /*
       * IMPORTANT:
       *
       * If TP1 and entry are both reached on the
       * same observation, entry wins.
       *
       * This prevents a valid entry from becoming
       * MISSED on the same price update.
       */

      if (entryHit) {
        if (
          canTransition(
            STATES.READY,
            STATES.ENTRY_HIT
          )
        ) {
          next.status = STATES.ENTRY_HIT;
          next.entryHit = true;
          next.entryHitAt =
            next.entryHitAt || now;

          /*
           * ENTRY_HIT is the recorded event.
           * The live lifecycle state becomes ACTIVE.
           */
          if (
            canTransition(
              STATES.ENTRY_HIT,
              STATES.ACTIVE
            )
          ) {
            next.status = STATES.ACTIVE;
          }

          return next;
        }
      }

      /*
       * TP1 reached before entry.
       */
      if (
        targetReached &&
        canTransition(
          STATES.READY,
          STATES.MISSED
        )
      ) {
        next.status = STATES.MISSED;
        next.outcome = "MISSED";
        next.closedAt = now;

        return next;
      }
    }

    return next;
  }

  /*
   * ----------------------------------------------------------
   * ACTIVE / TARGET PROGRESSION
   * ----------------------------------------------------------
   */

  if (
    currentState === STATES.ENTRY_HIT
  ) {
    if (
      canTransition(
        STATES.ENTRY_HIT,
        STATES.ACTIVE
      )
    ) {
      next.status = STATES.ACTIVE;
    }

    return next;
  }

  if (
    currentState === STATES.ACTIVE ||
    currentState === STATES.TP1_HIT ||
    currentState === STATES.TP2_HIT
  ) {
    const targets = Array.isArray(setup.targets)
      ? setup.targets
      : [];

    const expectedState =
      currentState === STATES.ACTIVE
        ? STATES.TP1_HIT
        : currentState === STATES.TP1_HIT
          ? STATES.TP2_HIT
          : STATES.TP3_HIT;

    const expectedIndex =
      currentState === STATES.ACTIVE
        ? 1
        : currentState === STATES.TP1_HIT
          ? 2
          : 3;

    const target = targets.find(
      (item) =>
        item &&
        Number(item.index) === expectedIndex &&
        validPrice(item.price) &&
        item.hit !== true
    );

    if (!target) {
      return next;
    }

    const targetPrice = Number(target.price);

    const hit = isLong
      ? price >= targetPrice
      : price <= targetPrice;

    if (!hit) {
      return next;
    }

    if (
      !canTransition(
        currentState,
        expectedState
      )
    ) {
      return next;
    }

    next.targets = targets.map((item) =>
      Number(item.index) === expectedIndex
        ? {
            ...item,
            hit: true,
            hitAt: item.hitAt || now,
          }
        : item
    );

    next.status = expectedState;

    if (expectedState === STATES.TP3_HIT) {
      next.outcome = "WIN";
      next.closedAt = next.closedAt || now;
    }

    return next;
  }

  return next;
}

module.exports = {
  trackSetup,
};
