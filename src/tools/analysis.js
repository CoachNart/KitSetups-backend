const liquidityEngine = require("./liquidity");

function finite(value) {

const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getClosedCandles(candles) {
  return (candles || []).filter(
    candle => candle?.isClosed === true
  );
}

function getLiveCandle(candles) {
  const live = (candles || []).find(
    candle => candle?.isClosed === false
  );

  return live || null;
}

function highest(candles, field = "high") {
  if (!candles?.length) {
    return null;
  }

  const values = candles
    .map(c => finite(c[field]))
    .filter(x => x !== null);

  return values.length
    ? Math.max(...values)
    : null;
}

function lowest(candles, field = "low") {
  if (!candles?.length) {
    return null;
  }

  const values = candles
    .map(c => finite(c[field]))
    .filter(x => x !== null);

  return values.length
    ? Math.min(...values)
    : null;
}

/*
 * ---------------------------------------------------------
 * SWING DETECTION
 * ---------------------------------------------------------
 *
 * IMPORTANT:
 * Only CLOSED candles reach these functions.
 *
 * This prevents the currently forming candle from
 * creating or destroying a swing before it closes.
 */

function findSwingHighs(
  candles,
  strength = 2
) {
  const swings = [];

  if (
    !Array.isArray(candles) ||
    candles.length < strength * 2 + 1
  ) {
    return swings;
  }

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current =
      finite(candles[i]?.high);

    if (current === null) {
      continue;
    }

    let isSwing = true;

    for (
      let j = 1;
      j <= strength;
      j++
    ) {
      const left =
        finite(candles[i - j]?.high);

      const right =
        finite(candles[i + j]?.high);

      if (
        left === null ||
        right === null ||
        current <= left ||
        current <= right
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      swings.push({
        index: i,
        price: current,
        time: candles[i].openTime
      });
    }
  }

  return swings;
}

function findSwingLows(
  candles,
  strength = 2
) {
  const swings = [];

  if (
    !Array.isArray(candles) ||
    candles.length < strength * 2 + 1
  ) {
    return swings;
  }

  for (
    let i = strength;
    i < candles.length - strength;
    i++
  ) {
    const current =
      finite(candles[i]?.low);

    if (current === null) {
      continue;
    }

    let isSwing = true;

    for (
      let j = 1;
      j <= strength;
      j++
    ) {
      const left =
        finite(candles[i - j]?.low);

      const right =
        finite(candles[i + j]?.low);

      if (
        left === null ||
        right === null ||
        current >= left ||
        current >= right
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      swings.push({
        index: i,
        price: current,
        time: candles[i].openTime
      });
    }
  }

  return swings;
}

/*
 * ---------------------------------------------------------
 * MARKET STRUCTURE
 * ---------------------------------------------------------
 */

function detectStructure(candles) {
  if (
    !Array.isArray(candles) ||
    candles.length < 10
  ) {
    return {
      trend: "insufficient_data",
      lastSwingHigh: null,
      previousSwingHigh: null,
      lastSwingLow: null,
      previousSwingLow: null,
      swingHighs: [],
      swingLows: []
    };
  }

  const highs =
    findSwingHighs(candles);

  const lows =
    findSwingLows(candles);

  const lastHigh =
    highs.at(-1) || null;

  const previousHigh =
    highs.at(-2) || null;

  const lastLow =
    lows.at(-1) || null;

  const previousLow =
    lows.at(-2) || null;

  let trend = "range";

  if (
    lastHigh &&
    previousHigh &&
    lastLow &&
    previousLow
  ) {
    const higherHigh =
      lastHigh.price >
      previousHigh.price;

    const higherLow =
      lastLow.price >
      previousLow.price;

    const lowerHigh =
      lastHigh.price <
      previousHigh.price;

    const lowerLow =
      lastLow.price <
      previousLow.price;

    if (
      higherHigh &&
      higherLow
    ) {
      trend = "bullish";
    } else if (
      lowerHigh &&
      lowerLow
    ) {
      trend = "bearish";
    }
  }

  return {
    trend,

    lastSwingHigh:
      lastHigh,

    previousSwingHigh:
      previousHigh,

    lastSwingLow:
      lastLow,

    previousSwingLow:
      previousLow,

    swingHighs:
      highs.slice(-5),

    swingLows:
      lows.slice(-5)
  };
}

/*
 * ---------------------------------------------------------
 * LIQUIDITY
 * ---------------------------------------------------------
 */

function detectLiquidity(
  candles,
  structure
) {
  if (!structure) {
    return {
      buySide: [],
      sellSide: []
    };
  }

  const buySide = [];
  const sellSide = [];

  if (structure.lastSwingHigh) {
    buySide.push({
      type: "buy_side_liquidity",
      price:
        structure.lastSwingHigh.price,
      reason: "Recent swing high"
    });
  }

  if (structure.previousSwingHigh) {
    buySide.push({
      type: "buy_side_liquidity",
      price:
        structure.previousSwingHigh.price,
      reason: "Previous swing high"
    });
  }

  if (structure.lastSwingLow) {
    sellSide.push({
      type: "sell_side_liquidity",
      price:
        structure.lastSwingLow.price,
      reason: "Recent swing low"
    });
  }

  if (structure.previousSwingLow) {
    sellSide.push({
      type: "sell_side_liquidity",
      price:
        structure.previousSwingLow.price,
      reason: "Previous swing low"
    });
  }

  return {
    buySide,
    sellSide
  };
}

/*
 * ---------------------------------------------------------
 * FAIR VALUE GAPS
 * ---------------------------------------------------------
 *
 * FVGs are calculated only from CLOSED candles.
 *
 * The currently forming candle cannot create a confirmed
 * FVG yet.
 */

function detectFVGs(candles) {
  const fvgs = [];

  if (
    !Array.isArray(candles) ||
    candles.length < 3
  ) {
    return fvgs;
  }

  for (
    let i = 2;
    i < candles.length;
    i++
  ) {
    const first =
      candles[i - 2];

    const middle =
      candles[i - 1];

    const third =
      candles[i];

    if (
      !first ||
      !middle ||
      !third
    ) {
      continue;
    }

    const firstHigh =
      finite(first.high);

    const firstLow =
      finite(first.low);

    const thirdHigh =
      finite(third.high);

    const thirdLow =
      finite(third.low);

    if (
      firstHigh === null ||
      firstLow === null ||
      thirdHigh === null ||
      thirdLow === null
    ) {
      continue;
    }

    /*
     * Bullish FVG:
     *
     * third candle low remains above
     * first candle high.
     */
    if (
      thirdLow > firstHigh
    ) {
      fvgs.push({
        type: "bullish",
        low: firstHigh,
        high: thirdLow,
        createdAt:
          third.openTime
      });
    }

    /*
     * Bearish FVG:
     *
     * third candle high remains below
     * first candle low.
     */
    if (
      thirdHigh < firstLow
    ) {
      fvgs.push({
        type: "bearish",
        low: thirdHigh,
        high: firstLow,
        createdAt:
          third.openTime
      });
    }
  }

  return fvgs.slice(-20);
}

/*
 * ---------------------------------------------------------
 * TIMEFRAME ANALYSIS
 * ---------------------------------------------------------
 */


function analyzeWeeklyCRT(candles) {
  const all = Array.isArray(candles) ? candles : [];
  const closed = getClosedCandles(all);
  const live = getLiveCandle(all);

  if (closed.length < 1 || !live) {
    return { status: "insufficient_data" };
  }

  const previousWeek = closed.at(-1);
  const currentWeek = live;

  const previousHigh = finite(previousWeek.high);
  const previousLow = finite(previousWeek.low);
  const previousOpen = finite(previousWeek.open);
  const previousClose = finite(previousWeek.close);

  const currentHigh = finite(currentWeek.high);
  const currentLow = finite(currentWeek.low);
  const currentClose = finite(currentWeek.close);

  if (
    previousHigh === null ||
    previousLow === null ||
    previousOpen === null ||
    previousClose === null ||
    currentHigh === null ||
    currentLow === null ||
    currentClose === null
  ) {
    return { status: "invalid_data" };
  }

  const previousMid = (previousHigh + previousLow) / 2;

  const sweptHigh = currentHigh > previousHigh;
  const sweptLow = currentLow < previousLow;

  const reclaimedAboveHigh = currentClose > previousHigh;
  const reclaimedBelowLow = currentClose < previousLow;

  const insideRange =
    currentClose < previousHigh &&
    currentClose > previousLow;

  let condition = "inside_previous_range";

  if (sweptHigh && reclaimedAboveHigh) {
    condition = "high_expansion";
  } else if (sweptLow && reclaimedBelowLow) {
    condition = "low_expansion";
  } else if (sweptHigh && insideRange) {
    condition = "high_sweep_rejection";
  } else if (sweptLow && insideRange) {
    condition = "low_sweep_rejection";
  }

  let position = "equilibrium";

  if (currentClose > previousMid) {
    position = "above_equilibrium";
  } else if (currentClose < previousMid) {
    position = "below_equilibrium";
  }

  return {
    status: "active",

    previousWeek: {
      high: previousHigh,
      low: previousLow,
      open: previousOpen,
      close: previousClose,
      midpoint: previousMid
    },

    currentWeek: {
      high: currentHigh,
      low: currentLow,
      close: currentClose,
      isLive: true
    },

    sweptPreviousHigh: sweptHigh,
    sweptPreviousLow: sweptLow,
    reclaimedPreviousHigh: reclaimedAboveHigh,
    reclaimedPreviousLow: reclaimedBelowLow,
    insidePreviousRange: insideRange,

    position,
    condition
  };
}


function analyzeWeeklyContext(candles) {
  const all = Array.isArray(candles) ? candles : [];
  const closed = getClosedCandles(all);
  const live = getLiveCandle(all);

  if (closed.length < 1) {
    return { status: "insufficient_data" };
  }

  const previousWeek = closed.at(-2) || closed.at(-1);
  const currentWeek = live || closed.at(-1);

  const previousHigh = finite(previousWeek.high);
  const previousLow = finite(previousWeek.low);
  const previousMid = (previousHigh + previousLow) / 2;

  const currentOpen = finite(currentWeek.open);
  const currentHigh = finite(currentWeek.high);
  const currentLow = finite(currentWeek.low);
  const currentClose = finite(currentWeek.close);

  if (
    previousHigh === null ||
    previousLow === null ||
    currentOpen === null ||
    currentHigh === null ||
    currentLow === null ||
    currentClose === null
  ) {
    return { status: "invalid_data" };
  }

  const aboveOpen = currentClose > currentOpen;
  const belowOpen = currentClose < currentOpen;

  const sweptHigh = currentHigh > previousHigh;
  const sweptLow = currentLow < previousLow;

  const aboveMid = currentClose > previousMid;
  const belowMid = currentClose < previousMid;

  const closedAboveHigh = currentClose > previousHigh;
  const closedBelowLow = currentClose < previousLow;

  let direction = "neutral";
  let condition = "inside_previous_range";

  if (closedAboveHigh) {
    direction = "bullish";
    condition = "bullish_breakout";
  } else if (closedBelowLow) {
    direction = "bearish";
    condition = "bearish_breakdown";
  } else if (sweptHigh && aboveOpen) {
    direction = "bullish";
    condition = "high_sweep_bullish";
  } else if (sweptLow && belowOpen) {
    direction = "bearish";
    condition = "low_sweep_bearish";
  } else if (aboveOpen && aboveMid) {
    direction = "bullish";
    condition = "bullish_development";
  } else if (belowOpen && belowMid) {
    direction = "bearish";
    condition = "bearish_development";
  } else if (aboveOpen) {
    direction = "bullish";
    condition = "above_weekly_open";
  } else if (belowOpen) {
    direction = "bearish";
    condition = "below_weekly_open";
  }

  return {
    status: live ? "active" : "closed",
    direction,
    condition,

    previousWeek: {
      high: previousHigh,
      low: previousLow,
      midpoint: previousMid
    },

    currentWeek: {
      open: currentOpen,
      high: currentHigh,
      low: currentLow,
      close: currentClose
    },

    sweptPreviousHigh: sweptHigh,
    sweptPreviousLow: sweptLow,

    closedAbovePreviousHigh: closedAboveHigh,
    closedBelowPreviousLow: closedBelowLow,

    aboveWeeklyOpen: aboveOpen,
    belowWeeklyOpen: belowOpen,

    abovePreviousMidpoint: aboveMid,
    belowPreviousMidpoint: belowMid
  };
}

function analyzeTimeframe(
  candles
) {
  const allCandles =
    Array.isArray(candles)
      ? candles
      : [];

  const closedCandles =
    getClosedCandles(
      allCandles
    );

  const liveCandle =
    getLiveCandle(
      allCandles
    );

  const structure =
    detectStructure(
      closedCandles
    );

  const liquidity =
    liquidityEngine.analyzeLiquidity({
      candles: closedCandles,
      structure
    });

  const fvgs =
    detectFVGs(
      closedCandles
    );

  const lastClosed =
    closedCandles.at(-1) || null;

  const weeklyCRT =
    analyzeWeeklyCRT(allCandles);

  const weeklyContext = analyzeWeeklyContext(allCandles);

  return {
    weeklyContext,
    candles:
      allCandles.length,

    closedCandles:
      closedCandles.length,

    closedCandleData:
    closedCandles,

  hasLiveCandle:
      Boolean(liveCandle),

    currentPrice:
      finite(
        liveCandle?.close ??
        lastClosed?.close
      ),

    lastClosedCandle:
      lastClosed,
    weeklyCRT:
      analyzeWeeklyCRT(allCandles),

    liveCandle,
    weeklyCRT,

    rangeHigh:
      highest(
        closedCandles
      ),

    rangeLow:
      lowest(
        closedCandles
      ),

    structure,

    liquidity,

    fvgs
  };
}

/*
 * ---------------------------------------------------------
 * FULL MARKET ANALYSIS
 * ---------------------------------------------------------
 */

function buildMarketAnalysis({
  ticker,
  timeframes
}) {
  const analysis = {};

  for (
    const [
      timeframe,
      candles
    ] of Object.entries(
      timeframes || {}
    )
  ) {
    const analyzedTimeframe =
      analyzeTimeframe(
        candles?.candles ?? candles
      );

    analysis[timeframe] = analyzedTimeframe;
  }

  return {
    symbol:
      ticker.symbol,

    currentPrice:
      ticker.lastPrice,

    market: {
      change24hPercent:
        ticker.change24hPercent,

      high24h:
        ticker.high24h,

      low24h:
        ticker.low24h,

      fundingRate:
        ticker.fundingRate,

      openInterest:
        ticker.openInterest,

      volume24h:
        ticker.volume24h
    },

    timeframes:
      analysis,

    generatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  getClosedCandles,
  getLiveCandle,
  findSwingHighs,
  findSwingLows,
  detectStructure,
  detectLiquidity,
  detectFVGs,
  analyzeTimeframe,
  buildMarketAnalysis
};
