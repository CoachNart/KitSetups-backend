'use strict';

const assert = require('node:assert/strict');
const { analyzeStructure } = require('../analysis/structure');
const { analyzeLiquidity } = require('../analysis/liquidity');
const { calculateEntry } = require('../setup/entry');
const { calculateStop } = require('../setup/stop');
const { buildTargets } = require('../setup/targets');
const { scoreSetup } = require('../quality/scorer');
const { trackSetup } = require('../../lifecycle/tracker');
const { STATES } = require('../../lifecycle/state');

function candles(n = 100, trend = 1) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i += 1) {
    const step = trend * (i % 4 === 0 ? 2 : 1);
    const open = price;
    const close = price + step;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    out.push({ openTime: i * 60000, open, high, low, close, isClosed: true });
    price = close;
  }
  return out;
}

// 1–2. Structure is valid and recognizes the expected hierarchy shape.
const bullishCandles = candles();
const structure = analyzeStructure(bullishCandles);
assert.equal(structure.valid, true);
assert.ok(['bullish', 'bearish', 'range'].includes(structure.direction));
assert.ok(Array.isArray(structure.swings.highs));
assert.ok(Array.isArray(structure.swings.lows));

// 3–4. Liquidity is derived from actual swings and remains directional.
const liquidity = analyzeLiquidity(bullishCandles, structure, bullishCandles.at(-1).close);
assert.equal(liquidity.valid, true);
assert.ok(Array.isArray(liquidity.buySide));
assert.ok(Array.isArray(liquidity.sellSide));

// 5. Entry is structural, not an arbitrary percentage/ATR offset.
const structures = {};
for (const tf of ['1w', '1d', '4h', '1h', '30m']) {
  structures[tf] = {
    ...structure,
    valid: true,
    direction: 'bullish',
    protectedLow: { price: 120, index: 60 },
    protectedHigh: { price: 145, index: 65 },
    breaks: { latest: { direction: 'bullish', kind: 'BOS', level: 125, index: 80 } },
  };
}
const entry = calculateEntry({
  direction: 'LONG',
  price: 130,
  structures,
  setup: { executionCandle: { low: 124, close: 130, high: 131 } },
});
assert.equal(entry.valid, true);
assert.equal(entry.price, 130);

// 6. Stop must be on the correct structural side.
const stop = calculateStop({ direction: 'LONG', entry: entry.price, structures });
assert.equal(stop.valid, true);
assert.equal(stop.stop, 120);
assert.ok(stop.reference.structuralLevel < entry.price);

// 7–9. Targets search progressively farther when the nearest objective is weak.
const levels = {};
for (const tf of ['30m', '1h', '4h', '1d', '1w']) {
  levels[tf] = {
    valid: true,
    buySide: [
      { price: 140, type: 'swing_high', side: 'buy_side', liquidityClass: 'external', swept: false },
      { price: 150, type: 'equal_highs', side: 'buy_side', liquidityClass: 'internal', swept: false },
      { price: 165, type: 'swing_high', side: 'buy_side', liquidityClass: 'external', swept: false },
    ],
    sellSide: [],
  };
}
const targets = buildTargets({ entry: 130, stop: 120, direction: 'LONG', liquidity: levels });
assert.equal(targets.valid, true);
assert.equal(targets.targets[0].price, 150);
assert.equal(targets.targets[0].riskReward, 2);
assert.ok(targets.targets.length >= 2);

// 10. Weighted quality score uses soft evidence rather than requiring perfect alignment.
const quality = scoreSetup({
  direction: 'LONG',
  setupType: 'CONTINUATION',
  setup: { type: 'CONTINUATION', break: { event: { kind: 'BOS', level: 125 } } },
  context: { bias: 'bullish', regime: 'trending' },
  structures,
  momentum: { timeframes: { '1h': { direction: 'neutral' }, '30m': { direction: 'bullish' } } },
  liquidity: levels,
  entry: 130,
  stop: 120,
  riskReward: 2,
  targets: targets.targets,
});
assert.ok(quality.score >= 70);
assert.ok(quality.score <= 100);
assert.equal(quality.valid, true);
assert.deepEqual(Object.keys(quality.components), [
  'higherTimeframe', 'executionStructure', 'liquidity', 'entryQuality', 'stopQuality', 'rewardRR', 'momentumContext',
]);
assert.equal(Object.values(quality.components).reduce((a, b) => a + b, 0) <= 100, true);

// 11–14. Lifecycle is monotonic, records target hits, handles a price jump, stop, miss and expiry.
const base = {
  direction: 'LONG',
  entry: 130,
  stop: 120,
  targets: [
    { index: 1, price: 150, hit: false },
    { index: 2, price: 165, hit: false },
    { index: 3, price: 180, hit: false },
  ],
};
let lifecycle = { status: STATES.READY, targets: base.targets };
lifecycle = trackSetup({ ...base, lifecycle }, 130);
assert.equal(lifecycle.status, STATES.ACTIVE);
assert.equal(lifecycle.entryHit, true);

lifecycle = trackSetup({ ...base, lifecycle }, 150);
assert.equal(lifecycle.status, STATES.TP1_HIT);
assert.equal(lifecycle.targets[0].hit, true);

// A fast move can touch TP2 and TP3 between checks without losing target history.
lifecycle = trackSetup({ ...base, lifecycle }, 181);
assert.equal(lifecycle.status, STATES.TP3_HIT);
assert.equal(lifecycle.targets[1].hit, true);
assert.equal(lifecycle.targets[2].hit, true);
assert.equal(lifecycle.outcome, 'WIN');

lifecycle = trackSetup({ ...base, lifecycle }, 181);
assert.equal(lifecycle.status, STATES.CLOSED);

const missed = trackSetup({ ...base, lifecycle: { status: STATES.READY, targets: base.targets } }, 119);
assert.equal(missed.status, STATES.MISSED);

const stopped = trackSetup({ ...base, lifecycle: { status: STATES.ACTIVE, targets: base.targets } }, 119);
assert.equal(stopped.status, STATES.STOP_LOSS);
assert.equal(stopped.outcome, 'LOSS');

const expired = trackSetup({
  ...base,
  expiresAt: '2026-01-01T00:00:00.000Z',
  lifecycle: { status: STATES.READY, targets: base.targets },
}, 125, '2026-01-02T00:00:00.000Z');
assert.equal(expired.status, STATES.EXPIRED);

console.log('KitSetups trading engine tests: PASS');
