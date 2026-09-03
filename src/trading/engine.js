'use strict';

const { getMarketData } = require('./data/marketData');
const { analyzeContext } = require('./analysis/context');
const { analyzeAllStructures } = require('./analysis/structure');
const { analyzeAllLiquidity } = require('./analysis/liquidity');
const { analyzeMomentum } = require('./analysis/momentum');
const { calculateEntry } = require('./setup/entry');
const { calculateStop } = require('./setup/stop');
const { buildTargets } = require('./setup/targets');
const { scoreSetup } = require('./quality/scorer');
const { createWaitResult, createSetupResult, validatePriceLevels } = require('./contract');

const TIMEFRAMES = ['1w', '1d', '4h', '1h', '30m'];
const PUBLISH_THRESHOLD = 70;

const finite = (v) => Number.isFinite(Number(v));
const number = (v) => Number(v);

function wait(symbol, price, stage, reason, analysis) {
  return createWaitResult({
    symbol,
    price,
    stage,
    reasons: [reason],
    context: analysis?.context,
    structures: analysis?.structures,
    liquidity: analysis?.liquidity,
    momentum: analysis?.momentum,
  });
}

function expectedDirection(direction) {
  return direction === 'LONG' ? 'bullish' : 'bearish';
}

function directional(structure, direction) {
  return structure?.direction === expectedDirection(direction);
}

function latestDirectionalBreak(structures, direction) {
  return TIMEFRAMES
    .map((timeframe) => ({ timeframe, event: structures?.[timeframe]?.breaks?.latest }))
    .filter(({ event }) => event?.direction === expectedDirection(direction) && finite(event.level))
    .sort((a, b) => number(b.event.index) - number(a.event.index))[0] || null;
}

function latestOpposingSweep(liquidity, direction) {
  const side = direction === 'LONG' ? 'sell_side' : 'buy_side';
  return TIMEFRAMES
    .flatMap((timeframe) => (liquidity?.[timeframe]?.sweeps || []).map((sweep) => ({ ...sweep, timeframe })))
    .filter((sweep) => sweep.side === side)
    .sort((a, b) => number(b.candleIndex) - number(a.candleIndex))[0] || null;
}

function directionCandidates({ context, structures, liquidity, momentum }) {
  return ['LONG', 'SHORT'].map((direction) => {
    const expected = expectedDirection(direction);
    const macro = ['1w', '1d', '4h'].filter((tf) => directional(structures?.[tf], direction)).length;
    const execution = ['1h', '30m'].filter((tf) => directional(structures?.[tf], direction)).length;
    const momentumVotes = ['1h', '30m'].filter((tf) => momentum?.timeframes?.[tf]?.direction === expected).length;
    const directionalBreak = latestDirectionalBreak(structures, direction);
    const sweep = latestOpposingSweep(liquidity, direction);
    const contextBias = context?.bias === expected;
    const recentBreak = directionalBreak ? number(directionalBreak.event.index) : -1;
    const recentSweep = sweep ? number(sweep.candleIndex) : -1;
    const reversal = Boolean(
      directionalBreak &&
      sweep &&
      recentBreak >= recentSweep &&
      directionalBreak.event.kind === 'CHoCH',
    );
    const continuation = Boolean(directionalBreak && (!sweep || recentBreak >= recentSweep));
    const pullback = macro >= 2 && execution >= 1;

    let type = null;
    if (reversal) type = 'REVERSAL';
    else if (continuation) type = 'CONTINUATION';
    else if (pullback) type = 'PULLBACK';

    if (!type) return null;

    let structuralScore = macro * 18 + execution * 14 + (directionalBreak ? 18 : 0) + (contextBias ? 12 : 0);
    if (reversal) structuralScore += 6;
    if (sweep) structuralScore += 6;
    if (context?.regime === 'trending' && continuation) structuralScore += 5;
    if (context?.regime === 'transitioning' && reversal) structuralScore += 5;

    return {
      direction,
      type,
      score: Math.min(100, structuralScore),
      macro,
      execution,
      momentumVotes,
      break: directionalBreak,
      sweep,
      contextBias,
      reasons: [
        `${type.toLowerCase()} structure identified`,
        `${macro}/3 macro timeframes support ${direction}`,
        `${execution}/2 execution timeframes support ${direction}`,
      ],
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

function selectDirection(args) {
  const candidates = directionCandidates(args);
  if (!candidates.length) return null;
  const best = candidates[0];
  const second = candidates[1];
  // Mixed evidence lowers confidence through scoring; it does not become a hard gate.
  if (second && second.score >= best.score - 3) return best.score >= 45 ? best : null;
  return best.score >= 35 ? best : null;
}

function executionCandle(marketData) {
  const candles = marketData?.timeframes?.['30m']?.candles;
  return Array.isArray(candles) && candles.length ? candles[candles.length - 1] : null;
}

function entryForSetup({ marketData, structures, setup }) {
  const price = number(marketData.ticker.lastPrice);
  const candle = executionCandle(marketData);
  const result = calculateEntry({
    direction: setup.direction,
    price,
    structures,
    setup: { executionCandle: candle },
  });

  if (result.valid) return result;

  // A valid structural pullback can be executable without a fresh break on the
  // 30m chart. Use the latest protected execution swing as the actual level.
  if (setup.type === 'PULLBACK') {
    const point = setup.direction === 'LONG'
      ? structures?.['30m']?.protectedLow
      : structures?.['30m']?.protectedHigh;
    const level = number(point?.price);
    const near = finite(level) && Math.abs(price - level) / Math.max(price, 1) <= 0.012;
    const onCorrectSide = setup.direction === 'LONG' ? price > level : price < level;
    if (near && onCorrectSide) {
      return {
        valid: true,
        price,
        mode: 'pullback',
        reference: { timeframe: '30m', structuralLevel: level },
        reason: 'Price is interacting with a protected execution structure level',
      };
    }
  }

  return result;
}

function buildThesis({ setup, entry, stop, targets, quality }) {
  const target = targets[0];
  return {
    structural: setup.reasons[0] || 'Directional market structure supports the setup.',
    liquidity: setup.sweep
      ? `Opposing liquidity was swept before the ${setup.direction.toLowerCase()} structural response.`
      : target
        ? `${target.liquidityClass || 'Meaningful'} liquidity provides a structural objective.`
        : 'No meaningful opposing liquidity objective is available.',
    entry: entry.reason || 'Entry is derived from the active structural setup model.',
    invalidation: stop.reason || `Setup invalidates beyond ${stop.stop}.`,
    quality: `Quality ${quality.score}/100 (${quality.grade}); ${quality.confidence}.`,
  };
}

function finalValidation({ direction, entry, stop, targets }) {
  const validation = validatePriceLevels({ direction, entry, stop, targets });
  if (!validation.valid) return validation;
  if (!targets.length) return { valid: false, reason: 'No valid targets established' };
  return { valid: true, reason: null };
}

async function analyzeSymbol(symbol) {
  if (!symbol) throw new Error('symbol is required');

  const marketData = await getMarketData(symbol);
  const price = number(marketData?.ticker?.lastPrice);
  if (!finite(price) || price <= 0) return wait(symbol, null, 'marketData', 'Invalid market price');

  const context = analyzeContext(marketData);
  const structures = analyzeAllStructures(marketData);
  const liquidity = analyzeAllLiquidity(marketData, structures);
  const momentum = analyzeMomentum(marketData.timeframes);
  const analysis = { context, structures, liquidity, momentum };

  const validTimeframes = TIMEFRAMES.filter((tf) => structures?.[tf]?.valid).length;
  if (validTimeframes < 3) {
    return wait(symbol, price, 'data', 'Insufficient closed-candle data for a reliable multi-timeframe decision', analysis);
  }

  const setup = selectDirection(analysis);
  if (!setup) {
    return wait(symbol, price, 'decision', 'No structurally coherent directional opportunity is available', analysis);
  }

  const entry = entryForSetup({ marketData, structures, setup });
  if (!entry?.valid) {
    return wait(symbol, price, 'entry', entry?.reason || 'Price has not reached a chart-derived executable entry', analysis);
  }

  const stop = calculateStop({ direction: setup.direction, entry: entry.price, structures });
  if (!stop?.valid) {
    return wait(symbol, price, 'invalidation', stop?.reason || 'No structural invalidation level is available', analysis);
  }

  const targetResult = buildTargets({
    entry: entry.price,
    stop: stop.stop,
    direction: setup.direction,
    liquidity,
  });
  if (!targetResult?.valid || !targetResult.targets?.length) {
    return wait(symbol, price, 'targets', targetResult?.reason || 'No meaningful tradable liquidity target is available', analysis);
  }

  const quality = scoreSetup({
    direction: setup.direction,
    setupType: setup.type,
    setup,
    context,
    structures,
    liquidity,
    momentum,
    entry: entry.price,
    stop: stop.stop,
    riskReward: targetResult.riskReward,
    targets: targetResult.targets,
  });

  if (quality.score < PUBLISH_THRESHOLD) {
    return wait(symbol, price, 'quality', `Setup quality is ${quality.score}/100; publication threshold is ${PUBLISH_THRESHOLD}`, analysis);
  }

  const validation = finalValidation({
    direction: setup.direction,
    entry: entry.price,
    stop: stop.stop,
    targets: targetResult.targets,
  });
  if (!validation.valid) return wait(symbol, price, 'finalValidation', validation.reason, analysis);

  return createSetupResult({
    symbol: marketData.symbol,
    price,
    direction: setup.direction,
    setupType: setup.type,
    timeframe: setup.break?.timeframe || (entry.reference?.timeframe || '30m'),
    marketRegime: context.regime,
    entry: entry.price,
    stop: stop.stop,
    targets: targetResult.targets,
    quality,
    thesis: buildThesis({ setup, entry, stop, targets: targetResult.targets, quality }),
    reasons: [...setup.reasons, ...quality.reasons, targetResult.reason],
    context,
    structures,
    liquidity,
    momentum,
  });
}

function buildFinalSetup(args) {
  const validation = finalValidation(args);
  if (!validation.valid) return wait(args?.symbol, args?.price, 'finalValidation', validation.reason, args);
  return createSetupResult(args);
}

module.exports = {
  analyzeSymbol,
  buildFinalSetup,
  reject: wait,
  LIVE_STATUSES: ['READY', 'ENTRY_HIT', 'ACTIVE', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT'],
  PUBLISH_THRESHOLD,
};
