"use strict";

/*
 * KITSETUPS — HIGH CONFLUENCE TRADE ENGINE
 *
 * Hierarchy:
 *
 * 1W  → Macro regime
 * 1D  → Macro transition / continuation
 * 4H  → Confirmation gate
 * 1H  → Directional confirmation
 * 30M → Setup structure
 * 30M → Execution
 *       ↓
 * Liquidity
 *       ↓
 * Sweep
 *       ↓
 * Displacement
 *       ↓
 * BOS / CHoCH
 *       ↓
 * POI
 *       ↓
 * Entry
 *       ↓
 * SL
 *       ↓
 * TP
 *
 * IMPORTANT:
 * This engine never guarantees a winning trade.
 * It is intentionally selective and returns WAIT
 * whenever mandatory confirmation is missing.
 */

const poiEngine = require("./poi");

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  const n = finite(value);

  if (n === null) {
    return null;
  }

  const factor = 10 ** decimals;

  return Math.round(n * factor) / factor;
}

function getTimeframe(
  snapshot,
  name
) {
  return (
    snapshot?.timeframes?.[name] ||
    null
  );
}

function getStructure(
  snapshot,
  name
) {
  return (
    snapshot?.structures?.[name] ||
    snapshot?.timeframes?.[name]?.structure ||
    null
  );
}

function getCandles(
  snapshot,
  name
) {
  return (
    snapshot?.timeframes?.[name]?.candles ||
    []
  );
}

function latestClosedCandle(
  candles = []
) {
  return candles
    .filter(
      candle =>
        candle &&
        candle.isClosed !== false
    )
    .at(-1) || null;
}

function candleRange(
  candle
) {
  const high =
    finite(candle?.high);

  const low =
    finite(candle?.low);

  if (
    high === null ||
    low === null
  ) {
    return null;
  }

  return high - low;
}

function candleBody(
  candle
) {
  const open =
    finite(candle?.open);

  const close =
    finite(candle?.close);

  if (
    open === null ||
    close === null
  ) {
    return null;
  }

  return Math.abs(
    close - open
  );
}

function candleDirection(
  candle
) {
  const open =
    finite(candle?.open);

  const close =
    finite(candle?.close);

  if (
    open === null ||
    close === null
  ) {
    return null;
  }

  if (close > open) {
    return "bullish";
  }

  if (close < open) {
    return "bearish";
  }

  return "neutral";
}

/*
 * ---------------------------------------------------------
 * MARKET REGIME
 * ---------------------------------------------------------
 */

function determineRegime(
  snapshot
) {
  const weekly =
    getStructure(
      snapshot,
      "1w"
    );

  const daily =
    getStructure(
      snapshot,
      "1d"
    );

  const fourHour =
    getStructure(
      snapshot,
      "4h"
    );

  const weeklyTrend =
    weekly?.trend || "unknown";

  const dailyTrend =
    daily?.trend || "unknown";

  const fourHourTrend =
    fourHour?.trend || "unknown";

  /*
   * Established bearish macro regime.
   */
  if (
    weeklyTrend === "bearish" &&
    dailyTrend === "bearish"
  ) {
    return {
      regime: "bearish_continuation",
      score: 80,
      weekly: weeklyTrend,
      daily: dailyTrend,
      reason: [
        "1W bearish",
        "1D bearish",
        "Macro bearish continuation"
      ]
    };
  }

  /*
   * Established bullish macro regime.
   */
  if (
    weeklyTrend === "bullish" &&
    dailyTrend === "bullish"
  ) {
    return {
      regime: "bullish_continuation",
      score: 80,
      weekly: weeklyTrend,
      daily: dailyTrend,
      reason: [
        "1W bullish",
        "1D bullish",
        "Macro bullish continuation"
      ]
    };
  }

  /*
   * Potential bullish transition.
   */
  if (
    weeklyTrend === "bearish" &&
    dailyTrend === "bullish"
  ) {
    return {
      regime: "bullish_reversal_watch",
      score:
        fourHourTrend === "bullish"
          ? 35
          : 15,
      weekly: weeklyTrend,
      daily: dailyTrend,
      reason: [
        "1W remains bearish",
        "1D has turned bullish",
        "Potential bullish macro transition",
        "Requires 4H confirmation"
      ]
    };
  }

  /*
   * Potential bearish transition.
   */
  if (
    weeklyTrend === "bullish" &&
    dailyTrend === "bearish"
  ) {
    return {
      regime: "bearish_reversal_watch",
      score:
        fourHourTrend === "bearish"
          ? 35
          : 15,
      weekly: weeklyTrend,
      daily: dailyTrend,
      reason: [
        "1W remains bullish",
        "1D has turned bearish",
        "Potential bearish macro transition",
        "Requires 4H confirmation"
      ]
    };
  }

  return {
    regime: "neutral",
    score: 0,
    weekly: weeklyTrend,
    daily: dailyTrend,
    reason: [
      "No established macro regime"
    ]
  };
}

/*
 * ---------------------------------------------------------
 * DIRECTIONAL HTF GATE
 * ---------------------------------------------------------
 */

function determineHTFDirection(snapshot) {
  const weekly = getStructure(snapshot, "1w");
  const daily = getStructure(snapshot, "1d");
  const fourHour = getStructure(snapshot, "4h");
  const oneHour = getStructure(snapshot, "1h");

  const w = weekly?.trend || "range";
  const d = daily?.trend || "range";

  /*
   * 4H confirmation must use the actual structural break when
   * the structure classifier has not yet promoted trend from
   * "range" to a directional state.
   *
   * Explicit trend remains authoritative. A directional BOS
   * can confirm the new structural leg when trend is still range.
   */
  const h4 =
    fourHour?.trend === "bullish" ||
    fourHour?.trend === "bearish"
      ? fourHour.trend
      : fourHour?.bullishBOS && !fourHour?.bearishBOS
        ? "bullish"
        : fourHour?.bearishBOS && !fourHour?.bullishBOS
          ? "bearish"
          : "range";

  const h1 = oneHour?.trend || "range";

  /*
   * 1W = macro context
   * 1D = primary directional bias
   * 4H = structural leg
   * 1H = trade decision
   * 30M = execution
   *
   * Pullbacks/corrections are NOT HTF mismatches.
   */

  let macroBias = "neutral";

  if (d === "bullish") {
    macroBias = "bullish";
  } else if (d === "bearish") {
    macroBias = "bearish";
  } else if (w === "bullish") {
    macroBias = "bullish";
  } else if (w === "bearish") {
    macroBias = "bearish";
  }

  if (macroBias === "neutral") {
    return {
      direction: "neutral",
      confirmed: false,
      marketState: "NO_MACRO_DIRECTION",
      weekly: w,
      daily: d,
      fourHour: h4,
      oneHour: h1,
      fourHourRole: "neutral",
      oneHourRole: "neutral",
      correction: false,
      macroBias: "neutral",
      reason: [
        `1W ${w} macro context`,
        `1D ${d} primary structure`,
        `4H ${h4} structural leg`,
        `1H ${h1} trade context`,
        "No directional macro bias from 1W or 1D"
      ]
    };
  }

  /*
   * REVERSAL CONFIRMATION GATE
   *
   * A 1D reversal against the 1W macro is only a
   * reversal WATCH until 4H confirms the new direction.
   *
   * Example:
   * 1W bearish + 1D bullish + 4H bearish
   * = bullish reversal watch, NOT confirmed LONG.
   *
   * The execution engine must never be allowed to
   * promote a reversal watch into a trade by itself.
   */
  const reversalWatch =
    (w === "bearish" && d === "bullish" && h4 !== "bullish") ||
    (w === "bullish" && d === "bearish" && h4 !== "bearish");

  if (reversalWatch) {
    const reversalDirection =
      d === "bullish"
        ? "bullish"
        : "bearish";

    return {
      direction: reversalDirection,
      confirmed: false,
      marketState: "REVERSAL_WATCH",
      weekly: w,
      daily: d,
      fourHour: h4,
      oneHour: h1,
      fourHourRole:
        reversalDirection === "bullish"
          ? "bullish_reversal_pending_4h"
          : "bearish_reversal_pending_4h",
      oneHourRole: "confirmation_pending",
      correction: true,
      macroBias: reversalDirection,
      reason: [
        `1W ${w} macro context`,
        `1D ${d} primary structure`,
        `4H ${h4} structural leg`,
        `1H ${h1} trade context`,
        `1D has reversed against 1W`,
        `4H has NOT confirmed the reversal`,
        "Reversal watch only — execution blocked until 4H confirmation"
      ]
    };
  }

  let fourHourRole = "range";

  if (macroBias === "bullish" && h4 === "bullish") {
    fourHourRole = "bullish_continuation";
  }

  if (macroBias === "bullish" && h4 === "bearish") {
    fourHourRole = "bullish_correction";
  }

  if (macroBias === "bearish" && h4 === "bearish") {
    fourHourRole = "bearish_continuation";
  }

  if (macroBias === "bearish" && h4 === "bullish") {
    fourHourRole = "bearish_correction";
  }

  let oneHourRole = "range";

  if (h1 === macroBias) {
    oneHourRole = "directional_confirmation";
  }

  if (macroBias === "bullish" && h1 === "bearish") {
    oneHourRole = "bullish_pullback";
  }

  if (macroBias === "bearish" && h1 === "bullish") {
    oneHourRole = "bearish_pullback";
  }

  const correction =
    (
      macroBias === "bullish" &&
      (h4 === "bearish" || h1 === "bearish")
    ) ||
    (
      macroBias === "bearish" &&
      (h4 === "bullish" || h1 === "bullish")
    );

  let marketState = "DIRECTIONAL";

  if (correction) {
    marketState = "CORRECTION";
  }

  if (h4 === "range" && h1 === "range") {
    marketState = "RANGE";
  }

  const reason = [
    `1W ${w} macro context`,
    `1D ${d} primary structure`,
    `4H ${h4} structural leg`,
    `1H ${h1} trade context`
  ];

  if (fourHourRole === "bullish_continuation") {
    reason.push("4H aligned with bullish macro direction");
  }

  if (fourHourRole === "bearish_continuation") {
    reason.push("4H aligned with bearish macro direction");
  }

  if (fourHourRole === "bullish_correction") {
    reason.push("4H correcting inside bullish macro structure");
  }

  if (fourHourRole === "bearish_correction") {
    reason.push("4H correcting inside bearish macro structure");
  }

  if (oneHourRole === "bullish_pullback") {
    reason.push("1H pulling back inside bullish macro structure");
  }

  if (oneHourRole === "bearish_pullback") {
    reason.push("1H pulling back inside bearish macro structure");
  }

  if (oneHourRole === "directional_confirmation") {
    reason.push("1H confirms macro direction");
  }

  if (h4 === "range") {
    reason.push("4H is ranging; waiting for structural resolution");
  }

  if (h1 === "range") {
    reason.push("1H is ranging; waiting for setup development");
  }

  /*
   * FINAL HTF CONFIRMATION
   *
   * 4H is the mandatory structural confirmation.
   * 1H may confirm the direction or act as a pullback.
   *
   * Therefore:
   *   4H aligned = trade direction confirmed
   *   4H opposite/range = no confirmation
   */
  const confirmed =
    h4 === macroBias ||
    (
      macroBias === "bullish" &&
      fourHour?.bullishBOS === true
    ) ||
    (
      macroBias === "bearish" &&
      fourHour?.bearishBOS === true
    );

  if (!confirmed) {
    reason.push(
      "4H confirmation is required before execution"
    );
  }

  return {
    direction: macroBias,
    confirmed,
    marketState,
    weekly: w,
    daily: d,
    fourHour: h4,
    oneHour: h1,
    fourHourRole,
    oneHourRole,
    correction,
    macroBias,
    reason
  };
}
/*
 * ---------------------------------------------------------
 * LIQUIDITY LEVELS
 * ---------------------------------------------------------
 */

function collectLiquidity(
  snapshot,
  direction
) {
  const normalized =
    String(direction || "").toLowerCase();

  const levels = [];

  /*
   * ---------------------------------------------------------
   * LIQUIDITY MAP
   * ---------------------------------------------------------
   *
   * Only consume data explicitly present in the snapshot.
   *
   * EXTERNAL:
   *   1W / 1D / 4H swing liquidity
   *
   * INTERNAL:
   *   1H / 30M swing liquidity
   *
   * PROTECTED:
   *   Explicit protected highs/lows exposed by the
   *   structure engine.
   *
   * No synthetic session levels.
   * No invented equal highs/lows.
   * No guessed liquidity.
   */

  const timeframes = [
    ["1w", "external"],
    ["1d", "external"],
    ["4h", "external"],
    ["1h", "internal"],
    ["30m", "internal"]
  ];

  function addLevel({
    price,
    type,
    side,
    timeframe,
    className,
    source,
    priority
  }) {
    const value =
      finite(price);

    if (value === null) {
      return;
    }

    levels.push({
      price: value,
      type,
      side,
      timeframe,
      liquidityClass: className,
      className,
      source,
      priority
    });
  }

  for (
    const [timeframe, className] of timeframes
  ) {
    const structure =
      getStructure(
        snapshot,
        timeframe
      );

    if (!structure) {
      continue;
    }

    const lastHigh =
      structure.lastSwingHigh?.price ??
      structure.lastSwingHigh;

    const previousHigh =
      structure.previousSwingHigh?.price ??
      structure.previousSwingHigh;

    const lastLow =
      structure.lastSwingLow?.price ??
      structure.lastSwingLow;

    const previousLow =
      structure.previousSwingLow?.price ??
      structure.previousSwingLow;

    /*
     * Buy-side liquidity exists above highs.
     */

    if (
      normalized === "bearish"
    ) {
      addLevel({
        price: lastHigh,
        type: "swing_high",
        side: "buy_side",
        timeframe,
        className,
        source: `${timeframe}_${className}_last_swing_high`,
        priority:
          className === "external"
            ? 3
            : 2
      });

      addLevel({
        price: previousHigh,
        type: "swing_high",
        side: "buy_side",
        timeframe,
        className,
        source: `${timeframe}_${className}_previous_swing_high`,
        priority:
          className === "external"
            ? 3
            : 1
      });
    }

    /*
     * Sell-side liquidity exists below lows.
     */

    if (
      normalized === "bullish"
    ) {
      addLevel({
        price: lastLow,
        type: "swing_low",
        side: "sell_side",
        timeframe,
        className,
        source: `${timeframe}_${className}_last_swing_low`,
        priority:
          className === "external"
            ? 3
            : 2
      });

      addLevel({
        price: previousLow,
        type: "swing_low",
        side: "sell_side",
        timeframe,
        className,
        source: `${timeframe}_${className}_previous_swing_low`,
        priority:
          className === "external"
            ? 3
            : 1
      });
    }

    /*
     * Explicit protected structure.
     *
     * These are added only when the structure engine exposes
     * them for this timeframe.
     */

    const protectedHigh =
      structure.protectedHigh?.price ??
      structure.protectedHigh;

    const protectedLow =
      structure.protectedLow?.price ??
      structure.protectedLow;

    if (
      normalized === "bearish"
    ) {
      addLevel({
        price: protectedHigh,
        type: "protected_high",
        side: "buy_side",
        timeframe,
        source: `${timeframe}_protected_high`,
        priority: 4
      });
    }

    if (
      normalized === "bullish"
    ) {
      addLevel({
        price: protectedLow,
        type: "protected_low",
        side: "sell_side",
        timeframe,
        source: `${timeframe}_protected_low`,
        priority: 4
      });
    }
  }

  /*
   * Remove exact duplicate levels while preserving the
   * strongest structural classification.
   */

  const deduped =
    new Map();

  for (
    const level of levels
  ) {
    const key =
      `${level.side}:${level.price}`;

    const existing =
      deduped.get(key);

    if (
      !existing ||
      level.priority > existing.priority
    ) {
      deduped.set(
        key,
        level
      );
    }
  }

  return [
    ...deduped.values()
  ].sort(
    (a, b) =>
      b.priority - a.priority
  );
}

function collectProtectedStructure(snapshot) {
  const result = {
    protectedHigh: null,
    protectedLow: null,

    highSource: null,
    lowSource: null,

    highTimeframe: null,
    lowTimeframe: null,

    available: false
  };

  /*
   * Protected structure must be explicitly exposed by the
   * structure engine.
   *
   * We do NOT assume that:
   *
   * lastSwingHigh = protectedHigh
   * lastSwingLow  = protectedLow
   *
   * A protected level is only accepted when the upstream
   * structure engine has identified it as protected.
   */

  const timeframes = [
    "1d",
    "4h",
    "1h",
    "30m"
  ];

  for (
    const timeframe of timeframes
  ) {
    const structure =
      getStructure(
        snapshot,
        timeframe
      );

    if (!structure) {
      continue;
    }

    const explicitHigh =
      finite(
        structure.protectedHigh?.price ??
        structure.protectedHigh
      );

    const explicitLow =
      finite(
        structure.protectedLow?.price ??
        structure.protectedLow
      );

    /*
     * Preserve the highest-timeframe explicit protected
     * structure available.
     */

    if (
      result.protectedHigh === null &&
      explicitHigh !== null
    ) {
      result.protectedHigh =
        explicitHigh;

      result.highSource =
        `${timeframe}_protected_high`;

      result.highTimeframe =
        timeframe;
    }

    if (
      result.protectedLow === null &&
      explicitLow !== null
    ) {
      result.protectedLow =
        explicitLow;

      result.lowSource =
        `${timeframe}_protected_low`;

      result.lowTimeframe =
        timeframe;
    }

    if (
      result.protectedHigh !== null &&
      result.protectedLow !== null
    ) {
      break;
    }
  }

  result.available =
    result.protectedHigh !== null ||
    result.protectedLow !== null;

  return result;
}

/*
 * ---------------------------------------------------------
 * LIQUIDITY SWEEP
 * ---------------------------------------------------------
 */

function detectLiquiditySweep(
  snapshot,
  direction
) {
  const candles =
    getCandles(
      snapshot,
      "30m"
    );

  const closed =
    candles.filter(
      candle =>
        candle &&
        candle.isClosed !== false
    );

  if (closed.length < 20) {
    return null;
  }

  const normalized =
      String(direction || "").toLowerCase();

    const bullish =
      normalized === "bullish" ||
      normalized === "long";

    const bearish =
      normalized === "bearish" ||
      normalized === "short";

    if (!bullish && !bearish) {
    return null;
  }

  /*
   * ---------------------------------------------------------
   * STRUCTURED LIQUIDITY SWEEP
   * ---------------------------------------------------------
   *
   * Do not manufacture liquidity from an arbitrary rolling
   * candle window.
   *
   * The sweep must interact with a liquidity level explicitly
   * exposed by the market structure/liquidity map.
   */

  const liquidityDirection =
      bullish
        ? "bullish"
        : "bearish";

    const liquidity =
      collectLiquidity(
        snapshot,
        liquidityDirection
      );

    if (!Array.isArray(liquidity) || !liquidity.length) {
    return null;
  }

  const candidates =
    liquidity.filter(
      level =>
        level &&
        finite(level.price) !== null &&
        (
          bullish
            ? level.side === "sell_side"
            : level.side === "buy_side"
        )
    );

  if (!candidates.length) {
    return null;
  }

  /*
   * Prefer structurally important liquidity:
   *
   * protected > external > internal.
   */

  const priorityOrder =
    [...candidates].sort(
      (a, b) =>
        (b.priority ?? 0) -
        (a.priority ?? 0)
    );

  /*
   * Search recent closed 30M candles.
   *
   * A valid sweep requires:
   *
   * LONG:
   *   low trades below sell-side liquidity
   *   AND candle closes back above the level.
   *
   * SHORT:
   *   high trades above buy-side liquidity
   *   AND candle closes back below the level.
   */

  const start =
    Math.max(
      1,
      closed.length - 25
    );

  const end =
    closed.length - 1;

  for (
    let i = end;
    i >= start;
    i--
  ) {
    const candle =
      closed[i];

    const high =
      finite(candle?.high);

    const low =
      finite(candle?.low);

    const close =
      finite(candle?.close);

    if (
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    /*
     * Test the strongest available liquidity first.
     */

    for (
      const level of priorityOrder
    ) {
      const liquidityPrice =
        finite(level.price);

      if (
        liquidityPrice === null
      ) {
        continue;
      }

      if (
        bullish &&
        low < liquidityPrice &&
        close > liquidityPrice
      ) {
        return {
          detected: true,

          direction: "bullish",

          type:
            "sell_side_sweep",

          liquidityType:
            level.type,

          liquidityClass:
            level.type === "protected_low"
              ? "protected"
              : level.priority >= 3
                ? "external"
                : "internal",

          liquiditySide:
            level.side,

          liquidityTimeframe:
            level.timeframe,

          liquiditySource:
            level.source,

          level:
            liquidityPrice,

          candle:
            candle.openTime,

          index: i,

          high,
          low,
          close,

          penetration:
            liquidityPrice - low,

          reclaimed:
            close > liquidityPrice
        };
      }

      if (
        bearish &&
        high > liquidityPrice &&
        close < liquidityPrice
      ) {
        return {
          detected: true,

          direction: "bearish",

          type:
            "buy_side_sweep",

          liquidityType:
            level.type,

          liquidityClass:
            level.type === "protected_high"
              ? "protected"
              : level.priority >= 3
                ? "external"
                : "internal",

          liquiditySide:
            level.side,

          liquidityTimeframe:
            level.timeframe,

          liquiditySource:
            level.source,

          level:
            liquidityPrice,

          candle:
            candle.openTime,

          index: i,

          high,
          low,
          close,

          penetration:
            high - liquidityPrice,

          reclaimed:
            close < liquidityPrice
        };
      }
    }
  }

  return null;
}

function detectDisplacement(
  candles = [],
  direction,
  sweep = null
) {
  const closed = candles.filter(
    candle =>
      candle &&
      candle.isClosed !== false
  );

  if (
    closed.length < 20 ||
    !sweep?.detected
  ) {
    return null;
  }

  const normalized =
      String(direction || "").toLowerCase();

    const bullish =
      normalized === "bullish" ||
      normalized === "long";

    const bearish =
      normalized === "bearish" ||
      normalized === "short";

    if (!bullish && !bearish) {
    return null;
  }

  const sweepIndex =
    Number(sweep.index);

  if (
    !Number.isInteger(sweepIndex) ||
    sweepIndex < 0 ||
    sweepIndex >= closed.length - 1
  ) {
    return null;
  }

  /*
   * Displacement must occur AFTER the liquidity sweep.
   *
   * We evaluate only the next six closed candles.
   *
   * Measurements are based entirely on OHLC:
   *
   * - candle direction
   * - body/range ratio
   * - range relative to preceding average range
   * - close location inside candle range
   * - continuation across two candles
   */

  const start =
    sweepIndex + 1;

  const end =
    Math.min(
      closed.length - 1,
      sweepIndex + 6
    );

  for (let i = start; i <= end; i++) {
    const candle = closed[i];

    const high =
      finite(candle?.high);

    const low =
      finite(candle?.low);

    const open =
      finite(candle?.open);

    const close =
      finite(candle?.close);

    const range =
      candleRange(candle);

    const body =
      candleBody(candle);

    if (
      high === null ||
      low === null ||
      open === null ||
      close === null ||
      range === null ||
      body === null ||
      range <= 0
    ) {
      continue;
    }

    const actualDirection =
      candleDirection(candle);

    const directionMatches =
      (
        bullish &&
        actualDirection === "bullish"
      ) ||
      (
        bearish &&
        actualDirection === "bearish"
      );

    if (!directionMatches) {
      continue;
    }

    /*
     * Average range of candles BEFORE
     * the candidate displacement candle.
     */
    const ranges = [];

    for (
      let j = Math.max(0, i - 20);
      j < i;
      j++
    ) {
      const value =
        candleRange(closed[j]);

      if (
        value !== null &&
        value > 0
      ) {
        ranges.push(value);
      }
    }

    if (!ranges.length) {
      continue;
    }

    const averageRange =
      ranges.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / ranges.length;

    if (
      !Number.isFinite(averageRange) ||
      averageRange <= 0
    ) {
      continue;
    }

    const bodyRatio =
      body / range;

    const rangeMultiple =
      range / averageRange;

    /*
     * Close location:
     *
     * LONG:
     * close near the candle high = stronger
     *
     * SHORT:
     * close near the candle low = stronger
     */
    const closeLocation =
      bullish
        ? (close - low) / range
        : (high - close) / range;

    /*
     * Deterministic quality components.
     *
     * These are measurements, not claims of prediction.
     */
    const bodyScore =
      Math.min(
        100,
        Math.max(
          0,
          (bodyRatio / 0.80) * 100
        )
      );

    const rangeScore =
      Math.min(
        100,
        Math.max(
          0,
          (rangeMultiple / 2.00) * 100
        )
      );

    const closeScore =
      Math.min(
        100,
        Math.max(
          0,
          closeLocation * 100
        )
      );

    /*
     * Two-candle continuation measurement.
     */
    let continuation = null;

    if (i > start) {
      const previous =
        closed[i - 1];

      const previousDirection =
        candleDirection(previous);

      const previousRange =
        candleRange(previous);

      const previousBody =
        candleBody(previous);

      if (
        previousDirection === actualDirection &&
        previousRange !== null &&
        previousBody !== null &&
        previousRange > 0
      ) {
        const previousBodyRatio =
          previousBody /
          previousRange;

        continuation = {
          detected: true,
          bodyRatio:
            previousBodyRatio,
          range:
            previousRange
        };
      }
    }

    /*
     * Strong single-candle displacement.
     *
     * Thresholds are deliberately explicit and
     * reproducible from the candle data.
     */
    const strongSingle =
      bodyRatio >= 0.55 &&
      rangeMultiple >= 1.20 &&
      closeLocation >= 0.65;

    /*
     * Two-candle displacement:
     * both candles must move in the same direction,
     * while the current candle must still demonstrate
     * meaningful expansion.
     */
    const strongTwoCandle =
      Boolean(continuation?.detected) &&
      continuation.bodyRatio >= 0.50 &&
      rangeMultiple >= 1.10 &&
      closeLocation >= 0.60;

    if (
      !strongSingle &&
      !strongTwoCandle
    ) {
      continue;
    }

    const quality =
      Math.round(
        (
          bodyScore * 0.40 +
          rangeScore * 0.35 +
          closeScore * 0.25
        ) * 100
      ) / 100;

    return {
      detected: true,

      direction:
        bullish
          ? "bullish"
          : "bearish",

      candle:
        candle.openTime,

      index: i,

      sweepIndex,

      high,
      low,
      open,
      close,

      range,

      body,

      bodyRatio:
        Math.round(
          bodyRatio * 10000
        ) / 10000,

      averageRange:
        Math.round(
          averageRange * 100
        ) / 100,

      rangeMultiple:
        Math.round(
          rangeMultiple * 10000
        ) / 10000,

      closeLocation:
        Math.round(
          closeLocation * 10000
        ) / 10000,

      continuation,

      model:
        strongSingle
          ? "single_candle"
          : "two_candle",

      qualityScore:
        Math.min(
          100,
          Math.max(
            0,
            quality
          )
        )
    };
  }

  return null;
}

function detectExecutionBreak(
  candles = [],
  direction,
  displacement = null
) {
  const closed = candles.filter(
    candle =>
      candle &&
      candle.isClosed !== false
  );

  if (
    closed.length < 20 ||
    !displacement?.detected
  ) {
    return null;
  }

  const displacementIndex =
    Number(displacement.index);

  if (
    !Number.isInteger(displacementIndex) ||
    displacementIndex < 3 ||
    displacementIndex >= closed.length - 1
  ) {
    return null;
  }

  const normalized =
    String(direction || "").toUpperCase();

  const bullish =
    normalized === "LONG";

  const bearish =
    normalized === "SHORT";

  if (!bullish && !bearish) {
    return null;
  }

  /*
   * Build structure from candles BEFORE displacement.
   *
   * We intentionally do not use the displacement candle
   * itself as the structural reference.
   */
  const structureStart =
    Math.max(
      2,
      displacementIndex - 8
    );

  const structureEnd =
    displacementIndex - 1;

  let level = null;
  let swingIndex = null;

  /*
   * LONG:
   * find a meaningful prior swing high.
   *
   * SHORT:
   * find a meaningful prior swing low.
   */
  for (
    let i = structureStart;
    i <= structureEnd;
    i++
  ) {
    const current = closed[i];
    const previous = closed[i - 1];
    const next =
      i + 1 < closed.length
        ? closed[i + 1]
        : null;

    const high =
      finite(current?.high);

    const low =
      finite(current?.low);

    if (
      high === null ||
      low === null
    ) {
      continue;
    }

    if (
      bullish &&
      previous &&
      next
    ) {
      const previousHigh =
        finite(previous.high);

      const nextHigh =
        finite(next.high);

      if (
        previousHigh !== null &&
        nextHigh !== null &&
        high >= previousHigh &&
        high >= nextHigh
      ) {
        if (
          level === null ||
          high > level
        ) {
          level = high;
          swingIndex = i;
        }
      }
    }

    if (
      bearish &&
      previous &&
      next
    ) {
      const previousLow =
        finite(previous.low);

      const nextLow =
        finite(next.low);

      if (
        previousLow !== null &&
        nextLow !== null &&
        low <= previousLow &&
        low <= nextLow
      ) {
        if (
          level === null ||
          low < level
        ) {
          level = low;
          swingIndex = i;
        }
      }
    }
  }

  /*
   * Fallback to the strongest structural extreme if a
   * strict local swing was not found.
   */
  if (
    level === null ||
    swingIndex === null
  ) {
    for (
      let i = structureStart;
      i <= structureEnd;
      i++
    ) {
      const high =
        finite(closed[i]?.high);

      const low =
        finite(closed[i]?.low);

      if (
        bullish &&
        high !== null &&
        (
          level === null ||
          high > level
        )
      ) {
        level = high;
        swingIndex = i;
      }

      if (
        bearish &&
        low !== null &&
        (
          level === null ||
          low < level
        )
      ) {
        level = low;
        swingIndex = i;
      }
    }
  }

  if (
    level === null ||
    swingIndex === null
  ) {
    return null;
  }

  /*
   * BOS must occur AFTER displacement.
   *
   * Require a CLOSED candle beyond the structural level.
   */
  for (
    let i = displacementIndex + 1;
    i < closed.length;
    i++
  ) {
    const candle =
      closed[i];

    const close =
      finite(candle?.close);

    if (close === null) {
      continue;
    }

    if (
      bullish &&
      close > level
    ) {
      return {
        detected: true,
        direction: "bullish",
        type: "BOS",
        level,
        candle: candle.openTime,
        index: i,
        displacementCandle:
          displacement.candle,
        displacementIndex,
        swingIndex
      };
    }

    if (
      bearish &&
      close < level
    ) {
      return {
        detected: true,
        direction: "bearish",
        type: "BOS",
        level,
        candle: candle.openTime,
        index: i,
        displacementCandle:
          displacement.candle,
        displacementIndex,
        swingIndex
      };
    }
  }

  return null;
}

function toTimestamp(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : null;
    }

    const parsed = Date.parse(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}


function analyzeExecutionPOI(
  snapshot,
  direction,
  price,
  displacement = null,
  executionBreak = null
) {
  const normalized =
    String(direction || "").toLowerCase();

  const isLong =
    normalized === "bullish" ||
    normalized === "long";

  const isShort =
    normalized === "bearish" ||
    normalized === "short";

  if (!isLong && !isShort) {
    return {
      nearest: null,
      retest: false,
      candidates: [],
      reason: ["Invalid POI direction"]
    };
  }

  const currentPrice =
    finite(price);

  /*
   * POIs come from the existing POI engine.
   * We do not manufacture FVGs or order blocks here.
   */

  let candidates = [];

  try {
    const result =
      poiEngine?.analyzePOIs
        ? poiEngine.analyzePOIs(snapshot)
        : null;

    if (Array.isArray(result)) {
      candidates = result;
    } else if (
      Array.isArray(result?.pois)
    ) {
      candidates = result.pois;
    }
  } catch (error) {
    candidates = [];
  }

  /*
   * Fallback to POIs already exposed by the snapshot.
   */

  if (!candidates.length) {
    const snapshotPOIs =
      snapshot?.pois ||
      snapshot?.POIs ||
      snapshot?.pointsOfInterest ||
      [];

    if (Array.isArray(snapshotPOIs)) {
      candidates = snapshotPOIs;
    }
  }

  const filtered =
    candidates
      .map((poi) => {
        const low =
          finite(
            poi?.low ??
            poi?.zoneLow ??
            poi?.bottom
          );

        const high =
          finite(
            poi?.high ??
            poi?.zoneHigh ??
            poi?.top
          );

        if (
          low === null ||
          high === null ||
          low >= high
        ) {
          return null;
        }

        const poiDirection =
          String(
            poi?.direction ??
            poi?.bias ??
            ""
          ).toLowerCase();

        const directionMatches =
          (
            isLong &&
            (
              poiDirection === "bullish" ||
              poiDirection === "long"
            )
          ) ||
          (
            isShort &&
            (
              poiDirection === "bearish" ||
              poiDirection === "short"
            )
          );

        if (!directionMatches) {
          return null;
        }

        const midpoint =
          (low + high) / 2;

        const distance =
          currentPrice === null
            ? null
            : Math.abs(
                currentPrice - midpoint
              );

        /*
         * Preserve factual POI state supplied by the engine.
         * Unknown fields remain unknown instead of being guessed.
         */

        const freshness =
          poi?.freshness ??
          null;

        const touched =
          poi?.touched ??
          null;

        const mitigated =
          poi?.mitigated ??
          null;

        const invalidated =
          poi?.invalidated ??
          null;

        const hasFVG =
          poi?.hasFVG ??
          (
            String(
              poi?.type || ""
            ).toLowerCase() === "fvg"
          );

        const hasOB =
          poi?.hasOB ??
          (
            String(
              poi?.type || ""
            ).toLowerCase().includes("ob")
          );

        const displacementQuality =
          finite(
            poi?.displacementQuality
          );

        const liquidityRelation =
          poi?.liquidityRelation ??
          null;

        const structureRelation =
          poi?.structureRelation ??
          null;

        const premiumDiscount =
          poi?.premiumDiscount ??
          null;

        /*
         * Quality is evidence-based.
         *
         * Only explicit facts receive points.
         * Unknown data receives zero.
         */

        let qualityScore = 0;

        if (
          freshness === true ||
          freshness === "fresh"
        ) {
          qualityScore += 20;
        }

        if (
          displacementQuality !== null
        ) {
          qualityScore += Math.min(
            20,
            Math.max(
              0,
              displacementQuality * 0.2
            )
          );
        }

        if (
          liquidityRelation
        ) {
          qualityScore += 20;
        }

        if (
          structureRelation
        ) {
          qualityScore += 20;
        }

        if (
          hasFVG === true
        ) {
          qualityScore += 10;
        }

        if (
          hasOB === true
        ) {
          qualityScore += 10;
        }

        if (
          invalidated === true ||
          mitigated === true
        ) {
          qualityScore = 0;
        }

        qualityScore =
          Math.round(
            Math.min(
              100,
              Math.max(
                0,
                qualityScore
              )
            ) * 100
          ) / 100;

        const inside =
          currentPrice !== null &&
          currentPrice >= low &&
          currentPrice <= high;

        return {
          ...poi,

          direction:
            poi?.direction ??
            normalized,

          low,
          high,
          midpoint,

          timeframe:
            poi?.timeframe ??
            null,

          freshness,
          displacementQuality,
          liquidityRelation,
          structureRelation,

          hasFVG,
          hasOB,

          hasConfluence:
            Boolean(
              liquidityRelation &&
              structureRelation
            ),

          touched,
          mitigated,
          invalidated,

          distanceFromPrice:
            distance,

          premiumDiscount,

          qualityScore,

          inside
        };
      })
      .filter(Boolean)
      .filter(
        poi =>
          poi.invalidated !== true
      );

  /*
   * Nearest POI means nearest valid directional POI.
   * No synthetic candidate is created.
   */

  filtered.sort(
    (a, b) => {
      const ad =
        a.distanceFromPrice;

      const bd =
        b.distanceFromPrice;

      if (
        ad === null &&
        bd === null
      ) {
        return (
          b.qualityScore -
          a.qualityScore
        );
      }

      if (ad === null) return 1;
      if (bd === null) return -1;

      if (ad !== bd) {
        return ad - bd;
      }

      return (
        b.qualityScore -
        a.qualityScore
      );
    }
  );

  const nearest =
    filtered[0] || null;

  /*
   * Retest requires actual price location inside the POI.
   * We do not call proximity a retest.
   */

  const retest =
    Boolean(
      nearest?.inside
    );

  return {
    nearest,
    retest,
    candidates: filtered,

    displacementLinked:
      Boolean(
        displacement?.detected
      ),

    structureLinked:
      Boolean(
        executionBreak?.detected
      ),

    reason:
      nearest
        ? [
            `Directional POI found on ${
              nearest.timeframe || "unknown"
            } timeframe`,
            `POI quality ${nearest.qualityScore}/100`,
            retest
              ? "Current price is inside POI"
              : "Current price has not retested POI"
          ]
        : [
            "No valid directional POI found"
          ]
  };
}

function evaluateExecution(
  snapshot,
  direction,
  price
) {
  const normalizedDirection =
    String(direction || "").toLowerCase();

  const isLong =
    normalizedDirection === "bullish" ||
    normalizedDirection === "long";

  const isShort =
    normalizedDirection === "bearish" ||
    normalizedDirection === "short";

  const executionDirection =
    isLong
      ? "LONG"
      : isShort
        ? "SHORT"
        : null;

  if (!executionDirection) {
    return {
      qualified: false,
      armed: false,
      status: "NO_TRADE",
      score: 0,
      normalizedScore: 0,
      hardGates: {
        validDirection: false
      },
      checks: [],
      reasons: [
        "Invalid execution direction"
      ]
    };
  }

  /*
   * ---------------------------------------------------------
   * MARKET CONTEXT
   * ---------------------------------------------------------
   */

  const context =
    determineHTFDirection(
      snapshot
    );

  const macroBias =
    String(
      context?.macroBias ||
      context?.direction ||
      "neutral"
    ).toLowerCase();

  /*
   * ---------------------------------------------------------
   * SETUP CLASSIFICATION
   *
   * We do NOT require every timeframe to agree.
   *
   * Continuation:
   *   macro direction and 4H structure agree.
   *
   * Pullback:
   *   macro direction exists but 4H is temporarily opposite.
   *
   * Reversal:
   *   daily context is transitioning against weekly context.
   *
   * Countertrend:
   *   execution direction is opposite the macro narrative.
   * ---------------------------------------------------------
   */

  let setupType =
    "UNCLASSIFIED";

  if (
    context?.reversalWatch === true
  ) {
    setupType =
      "REVERSAL";
  } else if (
    macroBias === normalizedDirection &&
    context?.fourHour === normalizedDirection
  ) {
    setupType =
      "CONTINUATION";
  } else if (
    macroBias === normalizedDirection
  ) {
    setupType =
      "PULLBACK";
  } else if (
    macroBias !== "neutral"
  ) {
    setupType =
      "COUNTERTREND";
  }

  /*
   * ---------------------------------------------------------
   * STRUCTURED LIQUIDITY
   * ---------------------------------------------------------
   */

  const liquidity =
    collectLiquidity(
      snapshot,
      normalizedDirection
    );

  const protectedStructure =
    collectProtectedStructure(
      snapshot
    );

  const liquidityAvailable =
    Array.isArray(liquidity) &&
    liquidity.length > 0;

  /*
   * ---------------------------------------------------------
   * EXECUTION CHAIN
   *
   * Liquidity
   *   ↓
   * Sweep
   *   ↓
   * Displacement
   *   ↓
   * BOS / CHoCH
   *   ↓
   * POI
   *   ↓
   * Retest
   * ---------------------------------------------------------
   */

  const sweep =
    detectLiquiditySweep(
      snapshot,
      executionDirection
    );

  const displacement =
    detectDisplacement(
      getCandles(
        snapshot,
        "30m"
      ),
      executionDirection,
      sweep
    );

  const executionBreak =
    detectExecutionBreak(
      getCandles(
        snapshot,
        "30m"
      ),
      executionDirection,
      displacement
    );

  const poi =
    analyzeExecutionPOI(
      snapshot,
      normalizedDirection,
      price,
      displacement,
      executionBreak
    );

  /*
   * ---------------------------------------------------------
   * EVIDENCE
   * ---------------------------------------------------------
   */

  const liquidityPass =
    liquidityAvailable;

  const sweepPass =
    Boolean(
      sweep?.detected
    );

  const displacementPass =
    Boolean(
      displacement?.detected
    );

  const structurePass =
    Boolean(
      executionBreak?.detected
    );

  const poiPass =
    Boolean(
      poi?.nearest
    );

  const retestPass =
    Boolean(
      poi?.retest
    );

  /*
   * Critical structural confirmation.
   *
   * The score can NEVER override this.
   */

  const criticalStructuralConfirmation =
    structurePass &&
    (
      executionBreak?.direction ===
      normalizedDirection
    );

  /*
   * A directional sweep is required before displacement.
   * This prevents a random displacement candle from becoming
   * an execution setup.
   */

  const criticalLiquidityConfirmation =
    liquidityPass &&
    sweepPass;

  /*
   * ---------------------------------------------------------
   * QUALITY SCORING
   *
   * Raw maximum = 100
   *
   * Macro context       15
   * Daily structure     15
   * 4H structure        15
   * Liquidity           15
   * Sweep               10
   * Displacement        10
   * BOS / CHoCH         10
   * POI quality         10
   * ---------------------------------------------------------
   */

  let score = 0;

  const macroPass =
    macroBias === normalizedDirection;

  const dailyPass =
    context?.daily === normalizedDirection;

  const fourHourPass =
    context?.fourHour === normalizedDirection;

  if (macroPass) {
    score += 15;
  }

  if (dailyPass) {
    score += 15;
  }

  if (fourHourPass) {
    score += 15;
  }

  if (liquidityPass) {
    score += 15;
  }

  if (sweepPass) {
    score += 10;
  }

  if (displacementPass) {
    score += 10;
  }

  if (structurePass) {
    score += 10;
  }

  const poiQuality =
    finite(
      poi?.nearest?.qualityScore
    );

  if (poiQuality !== null) {
    score +=
      Math.min(
        10,
        Math.max(
          0,
          poiQuality / 10
        )
      );
  }

  /*
   * ---------------------------------------------------------
   * TARGET + RISK
   * ---------------------------------------------------------
   *
   * We deliberately do not manufacture an entry/stop here.
   * Existing downstream entry/SL/TP calculations remain
   * responsible for actual prices.
   *
   * The evaluator only records whether the current structure
   * can support a valid internal-liquidity target.
   * ---------------------------------------------------------
   */

  let targetQuality = 0;
  let targetRR = null;

  try {
    const entry =
      finite(price);

    const existingStop =
      finite(
        snapshot?.tradePlan?.stop ??
        snapshot?.stop ??
        snapshot?.risk?.stop
      );

    if (
      entry !== null &&
      existingStop !== null
    ) {
      const targetResult =
        calculateTargets(
          snapshot,
          normalizedDirection,
          entry,
          existingStop
        );

      targetQuality =
        finite(
          targetResult?.targetQuality
        ) ?? 0;

      targetRR =
        finite(
          targetResult?.rr
        );
    }
  } catch (_) {
    targetQuality = 0;
    targetRR = null;
  }

  /*
   * ---------------------------------------------------------
   * HARD GATES
   * ---------------------------------------------------------
   *
   * These cannot be bought by a high score.
   * ---------------------------------------------------------
   */

    /* FINAL QUALITY — evidence score is capped to the defined 100-point model. */
    const baseQuality = score;

    const finalQuality =
      Math.min(
        100,
        Math.max(
          0,
          baseQuality
        )
      );

    const hardGates = {
      validDirection: true,

      liquidityAvailable:
        liquidityPass,

      liquiditySweep:
        sweepPass,

      displacementAfterSweep:
        displacementPass,

      criticalStructuralConfirmation:
        criticalStructuralConfirmation,

      directionalPOI:
        poiPass
    };

  /*
   * Retest is NOT required to create an ARMED setup.
   * It is required before ACTIVE.
   */

  const hardGateFailure =
    Object.entries(
      hardGates
    )
      .filter(
        ([, passed]) =>
          passed !== true
      )
      .map(
        ([name]) =>
          name
      );

  /*
   * Countertrend setups require stronger evidence.
   *
   * They are not rejected merely because macro direction
   * differs, but they cannot become ACTIVE without
   * exceptional execution evidence.
   */

  const countertrendRequiredScore = 90;

  const countertrendGate =
    setupType !== "COUNTERTREND" ||
    (
      finalQuality >=
      countertrendRequiredScore &&
      criticalLiquidityConfirmation &&
      criticalStructuralConfirmation &&
      poiPass &&
      retestPass
    );

  if (!countertrendGate) {
    hardGateFailure.push(
      "countertrend_quality_requirement"
    );
  }

  /*
   * ---------------------------------------------------------
   * STATE MACHINE
   * ---------------------------------------------------------
   *
   * NO_TRADE
   *   Critical evidence missing.
   *
   * WAIT
   *   Structure is developing but execution chain is not
   *   complete enough to arm.
   *
   * ARMED
   *   Sweep → displacement → structural confirmation →
   *   directional POI exist, but POI retest is not confirmed.
   *
   * ACTIVE
   *   Full execution chain is confirmed and quality threshold
   *   is satisfied.
   */

  const criticalFailure =
    hardGateFailure.length > 0;

  const qualityThreshold =
    finalQuality >= 70;

  const armed =
    !criticalFailure &&
    criticalLiquidityConfirmation &&
    criticalStructuralConfirmation &&
    poiPass;

  const qualified =
    armed &&
    retestPass &&
    qualityThreshold;

  let status = "WAIT";

  if (criticalFailure) {
    status = "NO_TRADE";
  } else if (qualified) {
    status = "READY";
  } else if (armed) {
    status = "ARMED";
  }

  /*
   * Explain exactly why the state was selected.
   */

  const stateReason = [];

  if (status === "NO_TRADE") {
    stateReason.push(
      `Critical conditions missing: ${
        hardGateFailure.join(", ")
      }`
    );
  }

  if (status === "WAIT") {
    stateReason.push(
      "Setup evidence is incomplete"
    );
  }

  if (status === "ARMED") {
    stateReason.push(
      "Execution chain confirmed; waiting for POI retest"
    );
  }

  if (status === "READY") {
    stateReason.push(
      "Execution chain confirmed and quality threshold passed; ready for entry"
    );
  }

  /*
   * Countertrend explanation.
   */

  if (
    setupType === "COUNTERTREND"
  ) {
    stateReason.push(
      `Countertrend minimum quality: ${
        countertrendRequiredScore
      }`
    );
  }


  /*
   * ---------------------------------------------------------
   * EXPLAINABILITY
   * ---------------------------------------------------------
   */

  const reasons = [];

  reasons.push(
    `Setup classification: ${setupType}`
  );

  reasons.push(
    macroPass
      ? "Macro direction supports execution direction"
      : "Macro direction does not support execution direction"
  );

  reasons.push(
    liquidityPass
      ? `Structured liquidity available: ${liquidity.length} levels`
      : "No structured liquidity available"
  );

  reasons.push(
    sweepPass
      ? `Liquidity sweep confirmed: ${
          sweep?.liquidityType ||
          sweep?.type ||
          "unknown"
        }`
      : "No valid directional liquidity sweep"
  );

  reasons.push(
    displacementPass
      ? "Displacement occurred after sweep"
      : "No confirmed displacement after sweep"
  );

  reasons.push(
    structurePass
      ? `Structural confirmation detected: ${
          executionBreak?.type ||
          "BOS/CHoCH"
        }`
      : "No confirmed structural break"
  );

  reasons.push(
    poiPass
      ? `Directional POI quality: ${
          poiQuality ?? 0
        }/100`
      : "No valid directional POI"
  );

  reasons.push(
    retestPass
      ? "Price has retested the selected POI"
      : "POI retest not confirmed"
  );

  if (
    protectedStructure?.available
  ) {
    reasons.push(
      `Protected structure available: ${
        protectedStructure.protectedHigh !== null
          ? "protected high"
          : ""
      }${
        protectedStructure.protectedHigh !== null &&
        protectedStructure.protectedLow !== null
          ? " + "
          : ""
      }${
        protectedStructure.protectedLow !== null
          ? "protected low"
          : ""
      }`
    );
  } else {
    reasons.push(
      "No explicit protected structure exposed by snapshot"
    );
  }

  if (
    hardGateFailure.length
  ) {
    reasons.push(
      `Hard gate failure: ${
        hardGateFailure.join(", ")
      }`
    );
  }

  return {
    qualified,

    armed,

    status,

    setupType,

    direction:
      normalizedDirection,

    executionDirection,

    score:
      Math.round(
        finalQuality
      ),

    normalizedScore:
      finalQuality,

    targetQuality,

    targetRR,

    hardGates,

    hardGateFailure,

    criticalStructuralConfirmation,

    criticalLiquidityConfirmation,

    checks: [
      {
        name: "macro_context",
        passed: macroPass,
        weight: 15
      },
      {
        name: "daily_structure",
        passed: dailyPass,
        weight: 15
      },
      {
        name: "4h_structure",
        passed: fourHourPass,
        weight: 15
      },
      {
        name: "liquidity",
        passed: liquidityPass,
        weight: 15
      },
      {
        name: "liquidity_sweep",
        passed: sweepPass,
        weight: 10
      },
      {
        name: "displacement_after_sweep",
        passed: displacementPass,
        weight: 10
      },
      {
        name: "BOS_CHoCH",
        passed: structurePass,
        weight: 10
      },
      {
        name: "POI_quality",
        passed: poiPass,
        quality:
          poiQuality
      },
      {
        name: "POI_retest",
        passed: retestPass
      }
    ],

    liquidity,

    protectedStructure,

    sweep,

    displacement,

    executionBreak,

    poi,

    reasons
  };
}

function calculateEntry(
  price,
  poi
) {
  const current =
    finite(price);

  if (
    current === null ||
    !poi
  ) {
    return null;
  }

  const poiLow =
    finite(poi.low);

  const poiHigh =
    finite(poi.high);

  if (
    poiLow === null ||
    poiHigh === null ||
    poiLow >= poiHigh
  ) {
    return null;
  }

  const midpoint =
    (poiLow + poiHigh) / 2;

  const direction =
    String(
      poi?.direction ??
      poi?.bias ??
      ""
    ).toLowerCase();

  if (
    direction === "bullish" ||
    direction === "long"
  ) {
    return midpoint < current
      ? midpoint
      : poiLow < current
        ? poiLow
        : null;
  }

  if (
    direction === "bearish" ||
    direction === "short"
  ) {
    return midpoint > current
      ? midpoint
      : poiHigh > current
        ? poiHigh
        : null;
  }

  return null;
}

/*
 * ---------------------------------------------------------
 * STOP
 * ---------------------------------------------------------
 */

function calculateStop(
  direction,
  poi,
  sweep
) {
  if (
    !poi
  ) {
    return null;
  }

  const poiLow =
    finite(
      poi.low
    );

  const poiHigh =
    finite(
      poi.high
    );

  const sweepLevel =
    finite(
      sweep?.level
    );

  if (
    poiLow === null ||
    poiHigh === null ||
    poiLow >= poiHigh
  ) {
    return null;
  }

  /*
   * Use the deepest structural invalidation reference.
   *
   * Do not round here. Rounding is deferred until the
   * final trade plan so low-priced assets do not collapse
   * entry and stop onto the same tick.
   */
  if (
    direction === "bullish"
  ) {
    const candidates = [
      poiLow,
      sweepLevel
    ].filter(
      value =>
        value !== null &&
        Number.isFinite(value)
    );

    if (!candidates.length) {
      return null;
    }

    const base =
      Math.min(
        ...candidates
      );

    /*
     * Small structural buffer below invalidation.
     */
    const buffer =
      Math.max(
        Math.abs(base) * 0.0015,
        Math.abs(poiHigh - poiLow) * 0.10
      );

    const stop =
      base - buffer;

    return Number.isFinite(stop)
      ? stop
      : null;
  }

  if (
    direction === "bearish"
  ) {
    const candidates = [
      poiHigh,
      sweepLevel
    ].filter(
      value =>
        value !== null &&
        Number.isFinite(value)
    );

    if (!candidates.length) {
      return null;
    }

    const base =
      Math.max(
        ...candidates
      );

    /*
     * Small structural buffer above invalidation.
     */
    const buffer =
      Math.max(
        Math.abs(base) * 0.0015,
        Math.abs(poiHigh - poiLow) * 0.10
      );

    const stop =
      base + buffer;

    return Number.isFinite(stop)
      ? stop
      : null;
  }

  return null;
}

/*
 * ---------------------------------------------------------
 * TARGET
 * ---------------------------------------------------------
 */

function calculateTargets(
  snapshot,
  direction,
  entry,
  stop
) {
  const normalized =
    String(direction || "").toLowerCase();

  const isLong =
    normalized === "bullish" ||
    normalized === "long";

  const isShort =
    normalized === "bearish" ||
    normalized === "short";

  const currentEntry =
    finite(entry);

  const currentStop =
    finite(stop);

  if (
    currentEntry === null ||
    currentStop === null ||
    (!isLong && !isShort)
  ) {
    return {
      valid: false,
      target: null,
      rr: null,
      targetType: null,
      targetQuality: 0,
      reason: [
        "Invalid entry, stop, or direction"
      ]
    };
  }

  const risk =
    Math.abs(
      currentEntry -
      currentStop
    );

  if (
    !Number.isFinite(risk) ||
    risk <= 0
  ) {
    return {
      valid: false,
      target: null,
      rr: null,
      targetType: null,
      targetQuality: 0,
      reason: [
        "Invalid trade risk"
      ]
    };
  }

  /*
   * TARGET MODEL
   *
   * Default execution target:
   *
   * LONG
   *   → nearest valid internal buy-side liquidity
   *
   * SHORT
   *   → nearest valid internal sell-side liquidity
   *
   * Internal liquidity is execution liquidity.
   * External liquidity remains contextual and is not
   * promoted simply to manufacture a better RR.
   */

  const liquidity =
    collectLiquidity(
      snapshot,
      normalized
    );

  if (
    !Array.isArray(liquidity) ||
    !liquidity.length
  ) {
    return {
      valid: false,
      target: null,
      rr: null,
      targetType: null,
      targetQuality: 0,
      reason: [
        "No structured liquidity available for target selection"
      ]
    };
  }

    const internalCandidates =
      liquidity
        .filter(level => {
          if (!level) {
            return false;
          }

          const levelPrice =
            finite(level.price);

          if (levelPrice === null) {
            return false;
          }

          /*
           * INTERNAL RANGE LIQUIDITY ONLY.
           *
           * Never promote external liquidity just
           * to manufacture a better RR.
           */
          if (
            level.liquidityClass !== "internal" &&
            level.className !== "internal"
          ) {
            return false;
          }

          /*
           * Protected structure is invalidation/context,
           * not the default RR target.
           */
          if (
            level.type === "protected_high" ||
            level.type === "protected_low"
          ) {
            return false;
          }

          /*
           * LONG:
           * nearest buy-side liquidity above entry.
           *
           * SHORT:
           * nearest sell-side liquidity below entry.
           */
          if (isLong) {
            return (
              level.side === "buy_side" &&
              levelPrice > currentEntry
            );
          }

          return (
            level.side === "sell_side" &&
            levelPrice < currentEntry
          );
        })
        .map(level => ({
          ...level,
          price:
            finite(level.price)
        }))
        .filter(level =>
          level.price !== null
        );

  if (!internalCandidates.length) {
    return {
      valid: false,
      target: null,
      rr: null,
      targetType: null,
      targetQuality: 0,
      reason: [
        "No valid internal range liquidity exists in the trade direction"
      ]
    };
  }

  /*
   * Nearest reachable internal liquidity.
   *
   * LONG → smallest level above entry.
   * SHORT → largest level below entry.
   */
  internalCandidates.sort(
    (a, b) =>
      isLong
        ? a.price - b.price
        : b.price - a.price
  );

  const selected =
    internalCandidates[0];

  const target =
    selected.price;

  const reward =
    isLong
      ? target - currentEntry
      : currentEntry - target;

  if (
    !Number.isFinite(reward) ||
    reward <= 0
  ) {
    return {
      valid: false,
      target: null,
      rr: null,
      targetType: null,
      targetQuality: 0,
      reason: [
        "Selected internal liquidity does not provide positive reward"
      ]
    };
  }

  const rr =
    reward / risk;

  /*
   * Target quality is based on the actual liquidity object.
   * No points are awarded for information that does not exist.
   */

  let targetQuality = 0;

  if (
    selected.timeframe === "30m"
  ) {
    targetQuality += 30;
  }

  if (
    selected.timeframe === "1h"
  ) {
    targetQuality += 35;
  }

  if (
    selected.type === "equal_highs" ||
    selected.type === "equal_lows"
  ) {
    targetQuality += 25;
  }

  if (
    selected.source
  ) {
    targetQuality += 10;
  }

  targetQuality =
    Math.min(
      100,
      targetQuality
    );

  return {
    valid: true,

    target,

    rr:
      Math.round(
        rr * 100
      ) / 100,

    reward:
      round(
        reward
      ),

    risk:
      round(
        risk
      ),

    targetType:
      "internal_liquidity",

    targetQuality,

    targetLiquidity: {
      price: target,
      type: selected.type,
      side: selected.side,
      timeframe: selected.timeframe,
      source: selected.source,
      priority: selected.priority
    },

    candidates:
      internalCandidates,

    reason: [
      `Targeting nearest valid internal liquidity`,
      `${selected.timeframe} ${selected.type}`,
      `Target ${target}`,
      `RR ${Math.round(rr * 100) / 100}`
    ]
  };
}

function calculateTarget(
  direction,
  entry,
  stop,
  snapshot
) {
  const targets =
    calculateTargets(
      snapshot,
      direction,
      entry,
      stop
    );

  return targets?.valid
    ? targets.target
    : null;
}

/*
 * ---------------------------------------------------------
 * FINAL SETUP GRADING
 * ---------------------------------------------------------
 *
 * Grade is based on confluence, not simply execution status.
 *
 * Components:
 *   - HTF alignment
 *   - Macro regime
 *   - Execution-chain confirmation
 *   - Risk/reward
 *
 * READY setups already have the complete execution chain,
 * so the final score distinguishes the quality of the setup.
 */

function gradeTradeSetup({
  regime,
  htf,
  execution,
  riskReward
}) {
  let points = 0;

  const rr = Number(riskReward);

  /*
   * HTF alignment
   */
  if (htf?.confirmed) {
    points += 25;
  }

  /*
   * Macro regime
   */
  const regimeScore =
    Number(regime?.score);

  if (Number.isFinite(regimeScore)) {
    if (regimeScore >= 80) {
      points += 20;
    } else if (regimeScore >= 35) {
      points += 10;
    }
  }

  /*
   * Complete execution chain.
   *
   * Five checks:
   * sweep
   * displacement
   * BOS
   * linked POI
   * POI retest
   */
  const executionScore =
    Number(execution?.score);

  if (Number.isFinite(executionScore)) {
    points += Math.min(
      executionScore * 0.25,
      25
    );
  }

  /*
   * Risk/reward quality.
   */
  if (Number.isFinite(rr)) {
    if (rr >= 4) {
      points += 30;
    } else if (rr >= 3) {
      points += 25;
    } else if (rr >= 2) {
      points += 20;
    } else if (rr >= 1.5) {
      points += 10;
    }
  }

  /*
   * Normalize to 100.
   */
  const score =
    Math.min(
      Math.round(points),
      100
    );

  let grade;

  if (score >= 85) {
    grade = "A";
  } else if (score >= 70) {
    grade = "B";
  } else if (score >= 55) {
    grade = "C";
  } else {
    grade = "WATCH";
  }

  const confidence =
    grade === "A"
      ? "HIGH"
      : grade === "B"
        ? "MEDIUM"
        : grade === "C"
          ? "LOW"
          : "WATCH";

  return {
    score,
    grade,
    confidence
  };
}


/*
 * ---------------------------------------------------------
 * MAIN TRADE PLAN
 * ---------------------------------------------------------
 */

function buildTradePlan(
  snapshot = {}
) {
  const symbol =
    snapshot.symbol ||
    snapshot.ticker?.symbol ||
    "UNKNOWN";

  const price =
    finite(
      snapshot.currentPrice ??
      snapshot.price ??
      snapshot.ticker?.lastPrice
    );

  const regime =
    determineRegime(
      snapshot
    );

  const htf =
    determineHTFDirection(
      snapshot
    );

  const base = {
    symbol,
    price,

    bias:
      htf.direction === "bullish"
        ? "bullish"
        : htf.direction === "bearish"
          ? "bearish"
          : "neutral",

    direction: "WAIT",
    status: "WAIT",

    score: 0,
    grade: "NO_TRADE",

    entry: null,
    stop: null,
    target: null,
    riskReward: null,

    execution: {
      required: true,
      status: "HTF_MISALIGNED"
    },

    regime,

    reason: [
      ...regime.reason,
      ...htf.reason
    ]
  };

  /*
   * HTF gate.
   */
  if (
    !htf.confirmed
  ) {
    return {
      ...base,
      execution: {
        required: false,
        status: "HTF_MISALIGNED"
      },
      reason: [
        ...base.reason,
        "4H/1H confirmation is incomplete",
        "High-confluence setup not available"
      ],
      generatedAt:
        new Date().toISOString()
    };
  }

  if (
    price === null
  ) {
    return {
      ...base,
      execution: {
        required: false,
        status: "INVALID_PRICE"
      },
      reason: [
        ...base.reason,
        "Current price is invalid"
      ],
      generatedAt:
        new Date().toISOString()
    };
  }

  /*
   * Execution gate.
   */
  const execution =
    evaluateExecution(
      snapshot,
      htf.direction,
      price
    );

  const executionReason =
    execution.checks
      .filter(
        check =>
          !check.passed
      )
      .map(
        check =>
          `${check.name} confirmation missing`
      );

  /*
   * Reject only incomplete execution chains.
   *
   * ARMED setups have a valid structural chain and are
   * waiting for the POI retest.
   */
  if (
    !execution.qualified &&
    !execution.armed
  ) {
    return {
      ...base,

      score:
        Math.round(execution.score * 0.15),

      grade:
        execution.score >= 50
          ? "WATCH"
          : "NO_TRADE",

      execution: {
        ...execution,
        status:
          execution.status
      },

      reason: [
        ...base.reason,
        ...executionReason,
        "Execution chain incomplete",
        "WAIT — do not manufacture an entry"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  /*
   * ARMED SETUP
   *
   * The complete execution structure exists, but price has
   * not yet returned to the execution POI.
   *
   * Do not manufacture an entry.
   */
  if (
    execution.armed &&
    !execution.qualified
  ) {
    const armedPOI =
      execution.poi?.nearest ||
      null;

    return {
      ...base,

      direction:
        htf.direction === "bullish"
          ? "LONG"
          : "SHORT",

      status: "ARMED",

      grade: "WATCH",

      score:
        Math.round(execution.score * 0.20),

      execution,

      entry: null,
      stop: null,
      target: null,
      riskReward: null,

      poi: armedPOI,

      reason: [
        ...base.reason,
        "Execution chain confirmed",
        "Valid execution POI identified",
        "Waiting for price to retest execution POI",
        "ARMED — no entry until POI retest"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  /*
   * POI must exist.
   */
  const selectedPOI =
    execution.poi?.nearest ||
    null;

  if (
    !selectedPOI
  ) {
    return {
      ...base,

      execution,

      reason: [
        ...base.reason,
        "No valid execution POI",
        "WAIT"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  const entry =
    calculateEntry(
      price,
      selectedPOI
    );

  const stop =
    calculateStop(
      htf.direction,
      selectedPOI,
      execution.sweep
    );

  const targets =
    calculateTargets(
      snapshot,
      htf.direction,
      entry,
      stop
    );

  const target =
    targets?.valid
      ? targets.target
      : null;

  if (
    entry === null ||
    stop === null ||
    target === null ||
    !targets?.valid
  ) {
    return {
      ...base,

      execution,

      reason: [
        ...base.reason,
        "Unable to calculate complete trade levels",
        "WAIT"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  /*
   * ---------------------------------------------------------
   * FINAL TRADE GEOMETRY VALIDATION
   * ---------------------------------------------------------
   *
   * LONG:
   *   stop   < entry < target
   *
   * SHORT:
   *   target < entry < stop
   *
   * Do not allow mathematically valid but directionally
   * invalid trade levels to reach the signal output.
   */

  const geometryValid =
    htf.direction === "bullish"
      ? (
          stop < entry &&
          target > entry
        )
      : htf.direction === "bearish"
        ? (
            stop > entry &&
            target < entry
          )
        : false;

  if (!geometryValid) {
    console.log(
      [
        "",
        "🚨 INVALID TRADE GEOMETRY DEBUG",
        `Symbol: ${symbol}`,
        `Direction: ${htf.direction}`,
        `Price: ${price}`,
        `Entry: ${entry}`,
        `Stop: ${stop}`,
        `Target: ${target}`,
        `Risk: ${Math.abs(entry - stop)}`,
        `POI type: ${selectedPOI?.type ?? "unknown"}`,
        `POI low: ${selectedPOI?.low ?? "unknown"}`,
        `POI high: ${selectedPOI?.high ?? "unknown"}`,
        `Sweep level: ${execution?.sweep?.level ?? "unknown"}`
      ].join("\n")
    );

    return {
      ...base,

      execution,

      reason: [
        ...base.reason,
        "Invalid trade geometry",
        htf.direction === "bullish"
          ? "LONG requires SL < Entry < TP"
          : "SHORT requires TP < Entry < SL",
        "WAIT"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  const risk =
    Math.abs(
      entry - stop
    );

  const reward =
    Math.abs(
      target - entry
    );

  const rawRiskReward =
    risk > 0
      ? reward / risk
      : null;

  /*
   * Normalize R:R before the final gate so floating-point
   * precision cannot reject a mathematically valid 2.0R setup.
   */
  const riskReward =
    rawRiskReward !== null
      ? Number(rawRiskReward.toFixed(4))
      : null;

  /*
   * Final minimum R:R gate.
   */
  if (
    riskReward === null ||
    riskReward < 2.0
  ) {
    return {
      ...base,

      execution,

      reason: [
        ...base.reason,
        `Risk/reward below minimum: ${round(
          riskReward,
          2
        )}R`,
        "WAIT"
      ],

      generatedAt:
        new Date().toISOString()
    };
  }

  const finalGrade =
    gradeTradeSetup({
      regime,
      htf,
      execution,
      riskReward
    });

  console.log(
    [
      "",
      "🏆 FINAL SETUP GRADE",
      `Symbol: ${symbol}`,
      `Grade: ${finalGrade.grade}`,
      `Score: ${finalGrade.score}`,
      `Confidence: ${finalGrade.confidence}`,
      `RR: ${riskReward}`,
      `HTF confirmed: ${htf.confirmed}`,
      `Regime score: ${regime?.score ?? 0}`,
      `Execution score: ${execution?.score ?? 0}/100`
    ].join("\n")
  );

  return {
    ...base,

    direction:
      htf.direction === "bullish"
        ? "LONG"
        : "SHORT",

    status: "READY",

    score: finalGrade.score,

    grade: finalGrade.grade,


    entry,
    stop,
    target,
      targets: [
        {
          index: 1,
          price: target
        }
      ],

    riskReward:
      round(
        riskReward,
        2
      ),

    execution: {
      ...execution,
      status: "EXECUTION_CONFIRMED"
    },

    setup: {
      poi: selectedPOI,
      sweep:
        execution.sweep,
      displacement:
        execution.displacement,
      bos:
        execution.executionBreak
    },

    reason: [
      ...base.reason,
      "HTF direction confirmed",
      "Liquidity sweep confirmed",
      "Displacement confirmed",
      "Execution BOS confirmed",
      "POI confirmed",
      "Risk/reward acceptable",
      "TRADE QUALIFIED"
    ],

    generatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  determineRegime,
  determineHTFDirection,
  detectLiquiditySweep,
  detectDisplacement,
  detectExecutionBreak,
  analyzeExecutionPOI,
  evaluateExecution,
  calculateEntry,
  calculateStop,
  calculateTarget,
  calculateTargets,
  buildTradePlan
};
