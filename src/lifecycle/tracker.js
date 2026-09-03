'use strict';

const { STATES, canTransition } = require('./state');

function finite(v) { return Number.isFinite(Number(v)); }
function positive(v) { return finite(v) && Number(v) > 0; }

function trackSetup(setup, currentPrice, nowValue = new Date()) {
  if (!setup || !positive(currentPrice)) throw new Error('setup and valid current price are required');
  if (!['LONG', 'SHORT'].includes(setup.direction)) throw new Error('valid setup direction is required');

  const state = setup.lifecycle?.status || STATES.READY;
  if (!Object.values(STATES).includes(state)) throw new Error(`Invalid lifecycle state: ${state}`);

  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const nowIso = now.toISOString();
  const price = Number(currentPrice);
  const long = setup.direction === 'LONG';
  const stop = Number(setup.stop);
  const entry = Number(setup.entry);
  const targets = Array.isArray(setup.targets) ? setup.targets : [];
  const next = {
    ...(setup.lifecycle || {}),
    lastPrice: price,
    lastCheckedAt: nowIso,
    targets: targets.map((target, index) => ({
      ...target,
      index: Number(target?.index) || index + 1,
      hit: target?.hit === true,
      hitAt: target?.hitAt || null,
    })),
  };

  // Terminal states never move backwards. CLOSED is deliberately terminal.
  if ([STATES.MISSED, STATES.CLOSED].includes(state)) return next;

  if (setup.expiresAt && new Date(setup.expiresAt).getTime() <= now.getTime() && state === STATES.READY) {
    next.status = STATES.EXPIRED;
    next.outcome = 'EXPIRED';
    next.closedAt = next.closedAt || nowIso;
    return next;
  }

  // Conservative chronology: if a live trade reaches its structural stop,
  // resolve the stop before processing profit targets for this price update.
  const stopHit = finite(stop) && (long ? price <= stop : price >= stop);
  if (stopHit) {
    if (state === STATES.READY) {
      next.status = STATES.MISSED;
      next.outcome = 'MISSED';
      next.closedAt = next.closedAt || nowIso;
      return next;
    }
    if (state === STATES.STOP_LOSS) {
      if (canTransition(state, STATES.CLOSED)) {
        next.status = STATES.CLOSED;
        next.outcome = next.outcome || 'LOSS';
        next.closedAt = next.closedAt || nowIso;
      }
      return next;
    }
    if (canTransition(state, STATES.STOP_LOSS)) {
      next.status = STATES.STOP_LOSS;
      next.stopLossHit = true;
      next.stopLossHitAt = next.stopLossHitAt || nowIso;
      next.outcome = 'LOSS';
      return next;
    }
  }

  if (state === STATES.READY) {
    const entryHit = finite(entry) && (long ? price >= entry : price <= entry);
    if (!entryHit) return next;
    if (canTransition(state, STATES.ENTRY_HIT)) {
      next.status = STATES.ACTIVE;
      next.entryHit = true;
      next.entryHitAt = next.entryHitAt || nowIso;
      return next;
    }
    return next;
  }

  if (state === STATES.ENTRY_HIT) {
    next.status = canTransition(state, STATES.ACTIVE) ? STATES.ACTIVE : state;
    return next;
  }

  if (state === STATES.STOP_LOSS) {
    if (canTransition(state, STATES.CLOSED)) {
      next.status = STATES.CLOSED;
      next.outcome = next.outcome || 'LOSS';
      next.closedAt = next.closedAt || nowIso;
    }
    return next;
  }

  if (state === STATES.TP3_HIT) {
    if (canTransition(state, STATES.CLOSED)) {
      next.status = STATES.CLOSED;
      next.outcome = next.outcome || 'WIN';
      next.closedAt = next.closedAt || nowIso;
    }
    return next;
  }

  // Mark every target that has genuinely been reached. This prevents a fast
  // market jump from losing TP1/TP2 history while keeping state monotonic.
  const reached = next.targets.filter((target) => {
    if (target.hit || !positive(target.price)) return false;
    return long ? price >= Number(target.price) : price <= Number(target.price);
  });

  if (!reached.length) return next;

  for (const reachedTarget of reached) {
    reachedTarget.hit = true;
    reachedTarget.hitAt = reachedTarget.hitAt || nowIso;
  }

  const highestHit = next.targets
    .filter((target) => target.hit)
    .reduce((max, target) => Math.max(max, Number(target.index) || 0), 0);

  const desired = highestHit >= 3 ? STATES.TP3_HIT : highestHit === 2 ? STATES.TP2_HIT : STATES.TP1_HIT;
  if (canTransition(state, desired)) {
    next.status = desired;
    if (desired === STATES.TP3_HIT) {
      next.outcome = 'WIN';
      next.closedAt = next.closedAt || nowIso;
    }
  }

  return next;
}

module.exports = { trackSetup };
