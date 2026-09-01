"use strict";

/*
 * KITSETUPS — TRADE LIFECYCLE STATE
 *
 * Lifecycle:
 *
 * READY
 *   ↓
 * ENTRY_HIT
 *   ↓
 * ACTIVE
 *   ├── TP1_HIT
 *   ├── TP2_HIT
 *   ├── TP3_HIT
 *   └── STOP_LOSS
 *         ↓
 *       CLOSED
 *
 * READY can also become MISSED when price invalidates
 * the opportunity before entry.
 */

const STATES = Object.freeze({
  READY: "READY",
  ENTRY_HIT: "ENTRY_HIT",
  ACTIVE: "ACTIVE",
  TP1_HIT: "TP1_HIT",
  TP2_HIT: "TP2_HIT",
  TP3_HIT: "TP3_HIT",
  STOP_LOSS: "STOP_LOSS",
  MISSED: "MISSED",
  CLOSED: "CLOSED",
});

const TERMINAL_STATES = new Set([
  STATES.MISSED,
  STATES.CLOSED,
]);

const TRANSITIONS = Object.freeze({
  [STATES.READY]: new Set([
    STATES.ENTRY_HIT,
    STATES.MISSED,
  ]),

  [STATES.ENTRY_HIT]: new Set([
    STATES.ACTIVE,
  ]),

  [STATES.ACTIVE]: new Set([
    STATES.TP1_HIT,
    STATES.TP2_HIT,
    STATES.TP3_HIT,
    STATES.STOP_LOSS,
    STATES.CLOSED,
  ]),

  [STATES.TP1_HIT]: new Set([
    STATES.TP2_HIT,
    STATES.TP3_HIT,
    STATES.STOP_LOSS,
    STATES.CLOSED,
  ]),

  [STATES.TP2_HIT]: new Set([
    STATES.TP3_HIT,
    STATES.STOP_LOSS,
    STATES.CLOSED,
  ]),

  [STATES.TP3_HIT]: new Set([
    STATES.CLOSED,
  ]),

  [STATES.STOP_LOSS]: new Set([
    STATES.CLOSED,
  ]),

  [STATES.MISSED]: new Set(),

  [STATES.CLOSED]: new Set(),
});

function canTransition(from, to) {
  return Boolean(
    TRANSITIONS[from]?.has(to)
  );
}

function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid lifecycle transition: ${from} -> ${to}`
    );
  }

  return true;
}

module.exports = {
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  canTransition,
  isTerminal,
  assertTransition,
};
