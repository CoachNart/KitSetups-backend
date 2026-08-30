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
  const h4 = fourHour?.trend || "range";
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
    h4 === macroBias;

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
  const structure =
    getStructure(
      snapshot,
      "30m"
    );

  const thirty =
    getStructure(
      snapshot,
      "30m"
    );

  const oneHour =
    getStructure(
      snapshot,
      "1h"
    );

  const levels = [];

  /*
   * For LONG:
   * sell-side liquidity is generally below price.
   *
   * For SHORT:
   * buy-side liquidity is generally above price.
   */
  const sources = [
    structure,
    thirty,
    oneHour
  ];

  for (
    const source of sources
  ) {
    if (!source) continue;

    if (
      direction === "bullish"
    ) {
      const lows = [
        source.lastSwingLow?.price,
        source.previousSwingLow?.price,
        source.bearishLevel
      ];

      for (
        const level of lows
      ) {
        const price =
          finite(level);

        if (
          price !== null
        ) {
          levels.push(price);
        }
      }
    }

    if (
      direction === "bearish"
    ) {
      const highs = [
        source.lastSwingHigh?.price,
        source.previousSwingHigh?.price,
        source.bullishLevel
      ];

      for (
        const level of highs
      ) {
        const price =
          finite(level);

        if (
          price !== null
        ) {
          levels.push(price);
        }
      }
    }
  }

  return [
    ...new Set(levels)
  ];
}

/*
 * ---------------------------------------------------------
 * LIQUIDITY SWEEP
 * ---------------------------------------------------------
 */

function detectLiquiditySweep(
  candles = [],
  direction
) {
  const closed = candles.filter(
    candle =>
      candle &&
      candle.isClosed !== false
  );

  if (closed.length < 20) {
    return null;
  }

  const normalized =
    String(direction || "").toUpperCase();

  const bullish = normalized === "LONG";
  const bearish = normalized === "SHORT";

  if (!bullish && !bearish) {
    return null;
  }

  /*
   * Search recent execution candles.
   *
   * LONG:
   *   price must raid a prior swing low and close back above it.
   *
   * SHORT:
   *   price must raid a prior swing high and close back below it.
   */
  const start =
    Math.max(
      6,
      closed.length - 25
    );

  const end =
    closed.length - 1;

  for (let i = end; i >= start; i--) {
    const candle = closed[i];

    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);

    if (
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    const lookbackStart =
      Math.max(2, i - 6);

    const previous =
      closed.slice(
        lookbackStart,
        i
      );

    if (previous.length < 3) {
      continue;
    }

    const highs =
      previous
        .map(c => finite(c?.high))
        .filter(v => v !== null);

    const lows =
      previous
        .map(c => finite(c?.low))
        .filter(v => v !== null);

    if (
      !highs.length ||
      !lows.length
    ) {
      continue;
    }

    const liquidityHigh =
      Math.max(...highs);

    const liquidityLow =
      Math.min(...lows);

    /*
     * LONG = sell-side liquidity sweep.
     */
    if (
      bullish &&
      low < liquidityLow &&
      close > liquidityLow
    ) {
      return {
        detected: true,
        direction: "bullish",
        type: "sell_side_sweep",
        level: liquidityLow,
        candle: candle.openTime,
        index: i,
        high,
        low,
        close
      };
    }

    /*
     * SHORT = buy-side liquidity sweep.
     */
    if (
      bearish &&
      high > liquidityHigh &&
      close < liquidityHigh
    ) {
      return {
        detected: true,
        direction: "bearish",
        type: "buy_side_sweep",
        level: liquidityHigh,
        candle: candle.openTime,
        index: i,
        high,
        low,
        close
      };
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
    String(direction || "").toUpperCase();

  const bullish = normalized === "LONG";
  const bearish = normalized === "SHORT";

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
   * Displacement MUST happen after the sweep.
   *
   * Search only the next 6 closed candles.
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

    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);

    const range =
      candleRange(candle);

    const body =
      candleBody(candle);

    if (
      high === null ||
      low === null ||
      close === null ||
      range === null ||
      body === null ||
      range <= 0
    ) {
      continue;
    }

    /*
     * Average range BEFORE the displacement candle.
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

    const average =
      ranges.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / ranges.length;

    if (
      !Number.isFinite(average) ||
      average <= 0
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

    const bodyRatio =
      body / range;

    const rangeMultiple =
      range / average;

    /*
     * Strong single-candle displacement.
     */
    const strongSingle =
      bodyRatio >= 0.55 &&
      rangeMultiple >= 1.20;

    /*
     * Two-candle displacement.
     *
     * This allows a strong impulsive move to develop over
     * two candles without accepting weak isolated candles.
     */
    let strongTwoCandle = false;

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
        const combinedRange =
          previousRange + range;

        const combinedBody =
          previousBody + body;

        strongTwoCandle =
          combinedRange > 0 &&
          combinedBody / combinedRange >= 0.55 &&
          combinedRange / average >= 1.50;
      }
    }

    if (
      !strongSingle &&
      !strongTwoCandle
    ) {
      continue;
    }

    /*
     * The displacement must actually move away from
     * the swept liquidity.
     */
    const sweptLevel =
      finite(sweep.level);

    if (sweptLevel !== null) {
      if (
        bullish &&
        close <= sweptLevel
      ) {
        continue;
      }

      if (
        bearish &&
        close >= sweptLevel
      ) {
        continue;
      }
    }

    return {
      detected: true,

      direction:
        bullish
          ? "bullish"
          : "bearish",

      candle:
        candle.openTime,

      index: i,

      sweepCandle:
        sweep.candle,

      sweepIndex,

      type:
        strongTwoCandle
          ? "two_candle_displacement"
          : "single_candle_displacement",

      bodyRatio:
        round(
          bodyRatio,
          3
        ),

      rangeMultiple:
        round(
          rangeMultiple,
          2
        ),

      high,
      low,
      close
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
  /*
   * ---------------------------------------------------------
   * EXECUTION POI
   * ---------------------------------------------------------
   *
   * The POI is NOT selected independently from the market.
   *
   * The chain is:
   *
   *   LIQUIDITY SWEEP
   *        ↓
   *   DISPLACEMENT
   *        ↓
   *   EXECUTION POI
   *        ↓
   *   BOS
   *        ↓
   *   POI RETEST
   *
   * Only a POI directly produced by the displacement move
   * is allowed to become the execution POI.
   */

  const empty = {
    available: false,
    nearest: null,
    insidePOI: false,
    retest: false,
    linked: false,
    executionPOI: null
  };

  if (
    !displacement?.detected ||
    !executionBreak?.detected
  ) {
    return empty;
  }

  const candles =
    getCandles(snapshot, "30m");

  if (!Array.isArray(candles) || candles.length < 5) {
    return empty;
  }

  const closedCandles =
    candles.filter(
      candle =>
        candle &&
        candle.isClosed !== false
    );

  if (closedCandles.length < 5) {
    return empty;
  }

  const displacementTime =
    toTimestamp(displacement.candle);

  const bosTime =
    toTimestamp(executionBreak.candle);

  if (
    displacementTime === null ||
    bosTime === null ||
    bosTime <= displacementTime
  ) {
    return empty;
  }

  const displacementIndex =
    closedCandles.findIndex(
      candle =>
        toTimestamp(candle.openTime) ===
        displacementTime
    );

  if (
    displacementIndex < 2 ||
    displacementIndex >= closedCandles.length
  ) {
    return empty;
  }

  const normalizedDirection =
    String(direction || "")
      .toLowerCase();

  const bullish =
    normalizedDirection === "bullish" ||
    normalizedDirection === "long";

  const bearish =
    normalizedDirection === "bearish" ||
    normalizedDirection === "short";

  if (!bullish && !bearish) {
    return empty;
  }

  const displacementCandle =
    closedCandles[displacementIndex];

  let originCandle = null;

  for (
    let i = displacementIndex - 1;
    i >= Math.max(0, displacementIndex - 5);
    i--
  ) {
    const candle = closedCandles[i];

    const open = finite(candle?.open);
    const close = finite(candle?.close);

    if (
      open === null ||
      close === null
    ) {
      continue;
    }

    if (
      bullish &&
      close < open
    ) {
      originCandle = candle;
      break;
    }

    if (
      bearish &&
      close > open
    ) {
      originCandle = candle;
      break;
    }
  }

  const twoBackCandle =
    closedCandles[displacementIndex - 2];

  const displacementOpen =
    finite(displacementCandle?.open);

  const displacementHigh =
    finite(displacementCandle?.high);

  const displacementLow =
    finite(displacementCandle?.low);

  const displacementClose =
    finite(displacementCandle?.close);

  const originOpen =
    finite(originCandle?.open);

  const originHigh =
    finite(originCandle?.high);

  const originLow =
    finite(originCandle?.low);

  const originClose =
    finite(originCandle?.close);

  const twoBackHigh =
    finite(twoBackCandle?.high);

  const twoBackLow =
    finite(twoBackCandle?.low);

  if (
    displacementHigh === null ||
    displacementLow === null ||
    displacementClose === null ||
    originHigh === null ||
    originLow === null ||
    originClose === null ||
    twoBackHigh === null ||
    twoBackLow === null
  ) {
    return empty;
  }

  /*
   * ---------------------------------------------------------
   * BUILD POIs FROM THE ACTUAL DISPLACEMENT
   * ---------------------------------------------------------
   */

  const candidates = [];

  /*
   * ---------------------------------------------------------
   * ORDER BLOCK
   * ---------------------------------------------------------
   *
   * The candle immediately preceding displacement must be
   * opposite in direction.
   *
   * Bullish:
   *   bearish origin candle → bullish displacement
   *
   * Bearish:
   *   bullish origin candle → bearish displacement
   */

  const originBearish =
    originClose < originOpen;

  const originBullish =
    originClose > originOpen;

  if (
    bullish &&
    originBearish
  ) {
    candidates.push({
      type: "bullish_order_block",
      direction: "bullish",

      low: originLow,
      high: originHigh,

      originCandle:
        originCandle.openTime,

      confirmationCandle:
        displacementCandle.openTime,

      displacementCandle:
        displacementCandle.openTime,

      displacementIndex,

      source: "execution_displacement",

      strength: 2
    });
  }

  if (
    bearish &&
    originBullish
  ) {
    candidates.push({
      type: "bearish_order_block",
      direction: "bearish",

      low: originLow,
      high: originHigh,

      originCandle:
        originCandle.openTime,

      confirmationCandle:
        displacementCandle.openTime,

      displacementCandle:
        displacementCandle.openTime,

      displacementIndex,

      source: "execution_displacement",

      strength: 2
    });
  }

  /*
   * ---------------------------------------------------------
   * FAIR VALUE GAP
   * ---------------------------------------------------------
   *
   * The FVG must be created by the displacement candle.
   *
   * Bullish:
   *   displacement low > candle[-2] high
   *
   * Bearish:
   *   displacement high < candle[-2] low
   */

  if (
    bullish &&
    displacementLow > twoBackHigh
  ) {
    candidates.push({
      type: "bullish_fvg",
      direction: "bullish",

      low: twoBackHigh,
      high: displacementLow,

      originCandle:
        closedCandles[displacementIndex - 2]?.openTime ?? null,

      confirmationCandle:
        displacementCandle.openTime,

      displacementCandle:
        displacementCandle.openTime,

      displacementIndex,

      source: "execution_displacement",

      strength: 1
    });
  }

  if (
    bearish &&
    displacementHigh < twoBackLow
  ) {
    candidates.push({
      type: "bearish_fvg",
      direction: "bearish",

      low: displacementHigh,
      high: twoBackLow,

      originCandle:
        closedCandles[displacementIndex - 2]?.openTime ?? null,

      confirmationCandle:
        displacementCandle.openTime,

      displacementCandle:
        displacementCandle.openTime,

      displacementIndex,

      source: "execution_displacement",

      strength: 1
    });
  }

  /*
   * No POI was actually created by the displacement.
   */
  if (!candidates.length) {
    console.log(
      [
        "",
        "🔍 NO POI DEBUG",
        `Direction: ${direction}`,
        `Displacement: ${displacementCandle.openTime}`,
        `Displacement open: ${displacementOpen}`,
        `Displacement high: ${displacementHigh}`,
        `Displacement low: ${displacementLow}`,
        `Displacement close: ${displacementClose}`,
        `Origin: ${originCandle.openTime}`,
        `Origin open: ${originOpen}`,
        `Origin high: ${originHigh}`,
        `Origin low: ${originLow}`,
        `Origin close: ${originClose}`,
        `Origin bearish: ${originBearish}`,
        `Origin bullish: ${originBullish}`,
        `Two-back high: ${twoBackHigh}`,
        `Two-back low: ${twoBackLow}`,
        `Bullish OB condition: ${bullish && originBearish}`,
        `Bearish OB condition: ${bearish && originBullish}`,
        `Bullish FVG condition: ${bullish && displacementLow > twoBackHigh}`,
        `Bearish FVG condition: ${bearish && displacementHigh < twoBackLow}`,
        `Candidates: ${candidates.length}`
      ].join("\n")
    );

    return {
      available: false,
      nearest: null,
      insidePOI: false,
      retest: false,
      linked: false,
      executionPOI: null
    };
  }

  /*
   * Prefer Order Block over FVG.
   *
   * If several candidates exist, prefer the one closest
   * to the displacement candle.
   */
  candidates.sort(
    (a, b) => {
      if (a.strength !== b.strength) {
        return b.strength - a.strength;
      }

      return (
        (b.displacementIndex ?? 0) -
        (a.displacementIndex ?? 0)
      );
    }
  );

  const poi =
    candidates[0] || null;

  if (!poi) {
    return empty;
  }

  /*
   * ---------------------------------------------------------
   * POI GEOMETRY VALIDATION
   * ---------------------------------------------------------
   */

  const poiLow =
    finite(poi.low);

  const poiHigh =
    finite(poi.high);

  if (
    poiLow === null ||
    poiHigh === null ||
    poiLow >= poiHigh
  ) {
    return empty;
  }

  /*
   * ---------------------------------------------------------
   * PRICE INSIDE POI
   * ---------------------------------------------------------
   */

  const currentPrice =
    finite(price);

  const inside =
    currentPrice !== null &&
    bosTime !== null &&
    currentPrice >= poiLow &&
    currentPrice <= poiHigh;

  /*
   * ---------------------------------------------------------
   * POST-BOS RETEST
   * ---------------------------------------------------------
   *
   * A candle before BOS can NEVER count.
   *
   * A candle must:
   *
   *   1. occur after BOS
   *   2. overlap the execution POI
   */

  /*
   * ---------------------------------------------------------
   * POST-BOS POI RETEST
   * ---------------------------------------------------------
   *
   * A historical retest must:
   *
   *   1. occur after BOS
   *   2. be a closed candle
   *   3. overlap the execution POI
   *
   * Current price inside the POI is handled separately.
   */

  const postBOSCandles =
    closedCandles.filter(
      candle => {
        const candleTime =
          toTimestamp(candle.openTime);

        return (
          candleTime !== null &&
          candleTime > bosTime
        );
      }
    );

  const recentRetestCandle =
    postBOSCandles
      .slice(-30)
      .some(
        candle => {
          const high =
            finite(candle.high);

          const low =
            finite(candle.low);

          if (
            high === null ||
            low === null
          ) {
            return false;
          }

          return (
            high >= poiLow &&
            low <= poiHigh
          );
        }
      );

  /*
   * Current price inside the POI after BOS is a live retest.
   */
  const retest =
    inside ||
    recentRetestCandle;

  /*
   * ---------------------------------------------------------
   * DIAGNOSTIC
   * ---------------------------------------------------------
   */

  if (!retest) {
    const lastClosed =
      closedCandles[
        closedCandles.length - 1
      ];

    const postBOSHighs =
      postBOSCandles
        .map(candle => finite(candle.high))
        .filter(value => value !== null);

    const postBOSLows =
      postBOSCandles
        .map(candle => finite(candle.low))
        .filter(value => value !== null);

    const highestPostBOS =
      postBOSHighs.length
        ? Math.max(...postBOSHighs)
        : null;

    const lowestPostBOS =
      postBOSLows.length
        ? Math.min(...postBOSLows)
        : null;

    console.log(
      [
        "",
        "🔎 EXECUTION POI RETEST DEBUG",
        `Direction: ${direction}`,
        `POI type: ${poi.type}`,
        `POI low: ${poiLow}`,
        `POI high: ${poiHigh}`,
        `Price: ${currentPrice}`,
        `Inside POI: ${inside}`,
        `Candle retest: ${recentRetestCandle}`,
        `Post-BOS closed candles: ${postBOSCandles.length}`,
        `Post-BOS highest: ${highestPostBOS ?? "N/A"}`,
        `Post-BOS lowest: ${lowestPostBOS ?? "N/A"}`,
        `Displacement: ${
          displacementCandle.openTime
        }`,
        `BOS: ${
          executionBreak.candle
        }`,
        `Last closed candle: ${
          lastClosed?.openTime ?? "unknown"
        }`,
        `POI origin: ${
          poi.originCandle ?? "unknown"
        }`
      ].join("\n")
    );
  }

  return {
    available: true,

    nearest: poi,

    insidePOI:
      inside,

    retest,

    linked: true,

    executionPOI: poi,

    candidates,

    displacement: {
      candle:
        displacementCandle.openTime,
      index:
        displacementIndex
    },

    bos: {
      candle:
        executionBreak.candle,
      index:
        executionBreak.index ?? null,
      level:
        executionBreak.level ?? null
    }
  };
}

function evaluateExecution(
  snapshot,
  direction,
  price
) {
  const candles =
    getCandles(
      snapshot,
      "15m"
    );

  if (candles.length < 30) {
    return {
      qualified: false,
      status: "INSUFFICIENT_EXECUTION_DATA",
      score: 0,
      required: 5,
      checks: []
    };
  }

  const executionDirection =
    direction === "bullish"
      ? "LONG"
      : "SHORT";

  /*
   * Linked execution chain:
   *
   * SWEEP
   *   ↓
   * DISPLACEMENT AFTER SWEEP
   *   ↓
   * BOS AFTER DISPLACEMENT
   *   ↓
   * POI FROM EXECUTION MOVE
   *   ↓
   * RETEST / PRICE INSIDE POI
   */
  const sweep =
    detectLiquiditySweep(
      candles,
      executionDirection
    );

  const displacement =
    detectDisplacement(
      candles,
      executionDirection,
      sweep
    );

  const executionBreak =
    detectExecutionBreak(
      candles,
      executionDirection,
      displacement
    );

  /*
   * ---------------------------------------------------------
   * BOS DEBUG
   * ---------------------------------------------------------
   *
   * Diagnostic only. Do not change execution logic here.
   */
  if (executionBreak?.detected) {
    console.log("\n🔎 BOS DEBUG");

    console.log(
      `Direction: ${executionBreak.direction}`
    );

    console.log(
      `BOS level: ${executionBreak.level}`
    );

    console.log(
      `BOS candle: ${
        executionBreak.candle
          ? new Date(
              toTimestamp(executionBreak.candle)
            ).toISOString()
          : "invalid"
      }`
    );

    console.log(
      `BOS index: ${executionBreak.index}`
    );

    console.log(
      `Displacement index: ${
        executionBreak.displacementIndex
      }`
    );

    console.log(
      `Displacement candle: ${
        displacement?.candle
          ? new Date(
              toTimestamp(displacement.candle)
            ).toISOString()
          : "invalid"
      }`
    );

    console.log(
      `Swing index: ${
        executionBreak.swingIndex
      }`
    );

    console.log(
      `Swing level: ${
        executionBreak.level
      }`
    );
  }

  const poi =
    analyzeExecutionPOI(
      snapshot,
      direction,
      price,
      displacement,
      executionBreak
    );

  const checks = [
    {
      name: "liquidity_sweep",
      passed:
        Boolean(sweep?.detected)
    },
    {
      name: "displacement_after_sweep",
      passed:
        Boolean(displacement?.detected)
    },
    {
      name: "execution_BOS_after_displacement",
      passed:
        Boolean(executionBreak?.detected)
    },
    {
      name: "linked_execution_POI",
      passed:
        Boolean(poi?.nearest)
    },
    {
      name: "POI_retest",
      passed:
        Boolean(poi?.retest)
    }
  ];

  const score =
    checks.filter(
      check =>
        check.passed
    ).length;

  /*
   * EXECUTION STATES
   *
   * ARMED means the complete structural chain exists:
   *
   * sweep
   * → displacement
   * → BOS
   * → linked execution POI
   *
   * Price has not yet retested the POI.
   */
  const armed =
    Boolean(sweep?.detected) &&
    Boolean(displacement?.detected) &&
    Boolean(executionBreak?.detected) &&
    Boolean(poi?.nearest);

  const qualified =
    armed &&
    Boolean(poi?.retest);

  return {
    qualified,

    armed,

    status:
      qualified
        ? "EXECUTION_CONFIRMED"
        : armed
          ? "EXECUTION_ARMED"
          : "EXECUTION_WAIT",

    score,

    required: 5,

    checks,

    sweep,

    displacement,

    executionBreak,

    poi
  };
}

/*
 * ---------------------------------------------------------
 * ENTRY
 * ---------------------------------------------------------
 */

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
    finite(
      poi.low
    );

  const poiHigh =
    finite(
      poi.high
    );

  if (
    poiLow === null ||
    poiHigh === null ||
    poiLow >= poiHigh
  ) {
    return null;
  }

  /*
   * Entry is the equilibrium of the actual execution POI.
   *
   * POIs are defined by low/high boundaries, so calculate
   * the midpoint directly instead of requiring a separate
   * midpoint property.
   */
  const midpoint =
    (poiLow + poiHigh) / 2;

  return midpoint;
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
  direction,
  entry,
  stop,
  snapshot,
  executionBreak = null
) {
  const e = finite(entry);
  const s = finite(stop);

  if (e === null || s === null) {
    return [];
  }

  const risk = Math.abs(e - s);

  if (risk <= 0) {
    return [];
  }

  const targetStructure = getStructure(
    snapshot,
    "1h"
  );

  const candidates =
    direction === "bullish"
      ? [
          targetStructure?.lastSwingHigh?.price,
          targetStructure?.previousSwingHigh?.price,
          getStructure(snapshot, "4h")?.lastSwingHigh?.price,
          executionBreak?.level
        ]
          .map(finite)
          .filter(
            value =>
              value !== null &&
              value > e
          )
          .sort((a, b) => a - b)
      : direction === "bearish"
        ? [
            targetStructure?.lastSwingLow?.price,
            targetStructure?.previousSwingLow?.price,
            getStructure(snapshot, "4h")?.lastSwingLow?.price,
            executionBreak?.level
          ]
            .map(finite)
            .filter(
              value =>
                value !== null &&
                value < e
            )
            .sort((a, b) => b - a)
        : [];

  const minimumR = 1.5;

  const structuralTargets =
    candidates.filter(value => {
      const rr =
        Math.abs(value - e) / risk;

      return rr >= minimumR;
    });

  const fallbackTargets =
    direction === "bullish"
      ? [
          e + risk * 1.5,
          e + risk * 2,
          e + risk * 3
        ]
      : direction === "bearish"
        ? [
            e - risk * 1.5,
            e - risk * 2,
            e - risk * 3
          ]
        : [];

  const targets = [];

  for (const value of structuralTargets) {
    if (
      !targets.some(
        existing =>
          Math.abs(existing - value) < 1e-8
      )
    ) {
      targets.push(value);
    }

    if (targets.length === 3) {
      break;
    }
  }

  for (const value of fallbackTargets) {
    if (targets.length === 3) {
      break;
    }

    if (
      !targets.some(
        existing =>
          Math.abs(existing - value) < 1e-8
      )
    ) {
      targets.push(value);
    }
  }

  /*
   * Deterministic TP ordering.
   *
   * LONG:
   *   TP1 < TP2 < TP3
   *
   * SHORT:
   *   TP1 > TP2 > TP3
   *
   * Structural and fallback targets may be mixed,
   * so normalize the final ordering before returning.
   */
  targets.sort(
    direction === "bullish"
      ? (a, b) => a - b
      : direction === "bearish"
        ? (a, b) => b - a
        : () => 0
  );

  return targets;
}

/*
 * Backwards-compatible single-target helper.
 *
 * TP1 remains the legacy `target` value.
 */
function calculateTarget(
  direction,
  entry,
  stop,
  snapshot
) {
  const targets =
    calculateTargets(
      direction,
      entry,
      stop,
      snapshot
    );

  return targets[0] ?? null;
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
      executionScore * 5,
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
        execution.score * 15,

      grade:
        execution.score >= 3
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
        execution.score * 20,

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
      htf.direction,
      entry,
      stop,
      snapshot,
      execution.executionBreak
    );

  const target =
    targets[0] ?? null;

  if (
    entry === null ||
    stop === null ||
    target === null ||
    targets.length === 0
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
   * precision cannot reject a mathematically valid 1.5R setup.
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
    riskReward < 1.5
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
      `Execution score: ${execution?.score ?? 0}/5`
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

    confidence:
      finalGrade.confidence,

    confidence: finalGrade.confidence,

    entry,
    stop,
    target,

    targets:
      targets.map(
        (price, index) => ({
          index: index + 1,
          price
        })
      ),

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
