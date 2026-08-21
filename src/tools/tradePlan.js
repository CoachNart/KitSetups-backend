const { findSwingHighs, findSwingLows } = require("./analysis");
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nearestAbove(levels, price) {
  return levels
    .map(finite)
    .filter(x => x !== null && x > price)
    .sort((a, b) => a - b)[0] || null;
}

function nearestBelow(levels, price) {
  return levels
    .map(finite)
    .filter(x => x !== null && x < price)
    .sort((a, b) => b - a)[0] || null;
}

function getLevels(tf) {
  return {
    buy: (tf?.liquidity?.buySide || [])
      .map(x => finite(x.price))
      .filter(x => x !== null),

    sell: (tf?.liquidity?.sellSide || [])
      .map(x => finite(x.price))
      .filter(x => x !== null)
  };
}

function calculateRR(entry, stop, target) {
  entry = finite(entry);
  stop = finite(stop);
  target = finite(target);

  if (
    entry === null ||
    stop === null ||
    target === null
  ) {
    return null;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  if (risk <= 0 || reward <= 0) {
    return null;
  }

  return Number((reward / risk).toFixed(2));
}

/*
 * ---------------------------------------------------------
 * BIAS
 * ---------------------------------------------------------
 */

function getBias(snapshot) {
  const timeframes = ["4h", "1h", "30m"];

  const states = timeframes.map(tf => ({
    timeframe: tf,
    trend: snapshot.timeframes?.[tf]?.structure?.trend
  }));

  const bullish = states.filter(
    x => x.trend === "bullish"
  );

  const bearish = states.filter(
    x => x.trend === "bearish"
  );

  const weeklyContext =
    snapshot.weeklyContext ||
    snapshot.timeframes?.["1w"]?.weeklyContext ||
    snapshot.timeframes?.["1w"]?.weeklyCRT ||
    null;

  const weeklyBullish =
    weeklyContext?.direction === "bullish";

  const weeklyBearish =
    weeklyContext?.direction === "bearish";

  /*
   * Weekly context is a bias filter, NOT a mandatory
   * trade-condition gate.
   *
   * Execution still requires:
   * POI -> 15M sweep -> displacement -> BOS -> RR.
   */

  let bias = "neutral";

  if (
    bullish.length >= 2 &&
    bullish.length > bearish.length
  ) {
    bias = "bullish";
  }

  if (
    bearish.length >= 2 &&
    bearish.length > bullish.length
  ) {
    bias = "bearish";
  }

  /*
   * Weekly live context gets priority when it clearly
   * confirms the lower-timeframe directional bias.
   */
  if (weeklyBullish && bullish.length >= 1) {
    bias = "bullish";
  }

  if (weeklyBearish && bearish.length >= 1) {
    bias = "bearish";
  }

  return {
    bias,
    bullishCount: bullish.length,
    bearishCount: bearish.length,
    weeklyContext,
    weeklyBullish,
    weeklyBearish,
    states
  };
}

/*
 * ---------------------------------------------------------
 * FVG / POI
 * ---------------------------------------------------------
 */

function getFVGs(tf, type, price) {
  return (tf?.fvgs || [])
    .map(x => ({
      type: x.type,
      low: finite(x.low),
      high: finite(x.high),
      createdAt: x.createdAt
    }))
    .filter(x =>
      x.type === type &&
      x.low !== null &&
      x.high !== null &&
      x.low < x.high
    )
    .filter(x => {
      if (type === "bullish") {
        return x.high < price;
      }

      return x.low > price;
    });
}

function findPOI(snapshot, direction, price) {
  const type =
    direction === "LONG"
      ? "bullish"
      : "bearish";

  const timeframes = [
    { timeframe: "1h", weight: 3 },
    { timeframe: "30m", weight: 2 },
    { timeframe: "15m", weight: 1 }
  ];

  const candidates = [];

  for (const {
    timeframe,
    weight
  } of timeframes) {
    const tf =
      snapshot.timeframes?.[timeframe];

    for (const zone of getFVGs(
      tf,
      type,
      price
    )) {
      const distance =
        direction === "LONG"
          ? price - zone.high
          : zone.low - price;

      if (
        !Number.isFinite(distance) ||
        distance < 0
      ) {
        continue;
      }

      /*
       * Higher timeframe zones receive more weight,
       * while distance still matters.
       *
       * A nearby 15m FVG can still beat a distant
       * 1h FVG, but comparable zones favor the HTF one.
       */
      const distanceScore =
        price > 0
          ? distance / price
          : distance;

      const score =
        distanceScore / weight;

      candidates.push({
        ...zone,
        timeframe,
        distance,
        score
      });
    }
  }

  candidates.sort(
    (a, b) => a.score - b.score
  );

  return candidates[0] || null;
}
/*
 * ---------------------------------------------------------
 * LIQUIDITY
 * ---------------------------------------------------------
 */

function getLiquidityTarget(
  snapshot,
  direction,
  price
) {
  const timeframes = [
    "4h",
    "1d",
    "1w"
  ];

  const levels = [];

  for (const timeframe of timeframes) {
    const {
      buy,
      sell
    } = getLevels(
      snapshot.timeframes?.[timeframe]
    );

    if (direction === "LONG") {
      levels.push(...buy);
    } else {
      levels.push(...sell);
    }
  }

  if (direction === "LONG") {
    return nearestAbove(
      levels,
      price
    );
  }

  return nearestBelow(
    levels,
    price
  );
}

/*
 * ---------------------------------------------------------
 * CANDLE HELPERS
 * ---------------------------------------------------------
 */

function closedCandles(tf) {
  if (Array.isArray(tf)) {
    return tf.filter(c => c?.isClosed !== false);
  }

  if (Array.isArray(tf?.closedCandleData)) {
    return tf.closedCandleData;
  }

  if (Array.isArray(tf?.closedCandles)) {
    return tf.closedCandles;
  }

  if (Array.isArray(tf?.candles)) {
    return tf.candles.filter(c => c?.isClosed !== false);
  }

  return [];
}

function candleBody(candle) {
  return Math.abs(
    Number(candle.close) -
    Number(candle.open)
  );
}

function candleRange(candle) {
  return (
    Number(candle.high) -
    Number(candle.low)
  );
}

function candleUpperWick(candle) {
  return (
    Number(candle.high) -
    Math.max(
      Number(candle.open),
      Number(candle.close)
    )
  );
}

function candleLowerWick(candle) {
  return (
    Math.min(
      Number(candle.open),
      Number(candle.close)
    ) -
    Number(candle.low)
  );
}

function isBullishCandle(candle) {
  return Number(candle.close) > Number(candle.open);
}

function isBearishCandle(candle) {
  return Number(candle.close) < Number(candle.open);
}

function candleMidpoint(candle) {
  return (
    Number(candle.high) +
    Number(candle.low)
  ) / 2;
}

/*
 * ---------------------------------------------------------
 * LIQUIDITY SWEEP
 * ---------------------------------------------------------
 *
 * LONG:
 * price takes a recent swing low and closes back above it.
 *
 * SHORT:
 * price takes a recent swing high and closes back below it.
 */

function detectSweep(
  tf,
  direction
) {
  const candles =
    closedCandles(tf);

  if (candles.length < 3) {
    return {
      detected: false,
      direction
    };
  }

  const structure =
    tf?.structure;

  const liquidity =
    tf?.liquidity;

  if (!structure || !liquidity) {
    return {
      detected: false,
      direction
    };
  }

  /*
   * LONG  = raid sell-side liquidity, then reclaim it.
   * SHORT = raid buy-side liquidity, then reject it.
   *
   * We use liquidity levels that existed before the
   * sweep candle. This prevents a candle from sweeping
   * a level that was created by itself.
   */

  const rawLevels =
    direction === "LONG"
      ? (liquidity.sellSide || [])
      : (liquidity.buySide || []);

  const levels =
    rawLevels
      .map(x => ({
        ...x,
        price: finite(x?.price)
      }))
      .filter(x => x.price !== null);

  if (levels.length === 0) {
    return {
      detected: false,
      direction
    };
  }

  /*
   * Look far enough back to include the POI reaction.
   * We don't want an old sweep from hours ago, but
   * 12 candles gives us a reasonable execution window.
   */
  const recentStart =
    Math.max(0, candles.length - 12);

  for (
    let i = recentStart;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    const candleTime =
      Date.parse(candle?.openTime);

    const low =
      finite(candle?.low);

    const high =
      finite(candle?.high);

    const close =
      finite(candle?.close);

    if (
      !Number.isFinite(candleTime) ||
      low === null ||
      high === null ||
      close === null
    ) {
      continue;
    }

    /*
     * Only use liquidity that existed BEFORE
     * this candle.
     */
    const eligibleLevels =
      levels.filter(level => {
        /*
         * Liquidity objects may not have a timestamp.
         * If they don't, fall back to the structural
         * swing arrays below.
         */
        return true;
      });

    for (
      const liquidityLevel of eligibleLevels
    ) {
      const level =
        liquidityLevel.price;

      if (direction === "LONG") {
        /*
         * Sell-side liquidity sweep.
         *
         * <= is intentional:
         * touching the exact liquidity price and
         * reclaiming it is still a valid sweep.
         */
        if (
          low <= level &&
          close > level
        ) {
          return {
            detected: true,
            direction,
            level,
            liquidity: liquidityLevel,
            candle,
            index: i,
            indexFromRecent:
              candles.length - 1 - i
          };
        }
      } else {
        /*
         * Buy-side liquidity sweep.
         */
        if (
          high >= level &&
          close < level
        ) {
          return {
            detected: true,
            direction,
            level,
            liquidity: liquidityLevel,
            candle,
            index: i,
            indexFromRecent:
              candles.length - 1 - i
          };
        }
      }
    }
  }

  return {
    detected: false,
    direction,
    levels: levels.map(
      x => x.price
    )
  };
}

/*
 * ---------------------------------------------------------
 * DISPLACEMENT
 * ---------------------------------------------------------
 *
 * We don't use a fixed dollar value.
 * We compare the latest closed candle's body/range
 * against recent candle bodies.
 */

function detectDisplacement(
  tf,
  direction
) {
  const candles =
    closedCandles(tf);

  if (candles.length < 3) {
    return {
      detected: false,
      direction
    };
  }

  /*
   * Displacement is a POST-SWEEP expansion.
   *
   * Do not require the latest candle to be
   * the displacement candle. Price may expand
   * over several candles after the sweep.
   */

  const searchCandles =
    candles.slice(1);

  for (let i = 0; i < searchCandles.length; i++) {
    const candle = searchCandles[i];

    const previous =
      searchCandles.slice(
        Math.max(0, i - 6),
        i
      );

    if (previous.length < 3) {
      continue;
    }

    const averageBody =
      previous.reduce(
        (sum, previousCandle) =>
          sum + candleBody(previousCandle),
        0
      ) / previous.length;

    const body =
      candleBody(candle);

    const range =
      candleRange(candle);

    if (
      !Number.isFinite(averageBody) ||
      averageBody <= 0 ||
      !Number.isFinite(body) ||
      !Number.isFinite(range) ||
      range <= 0
    ) {
      continue;
    }

    const bodyMultiple =
      body / averageBody;

    const bodyRatio =
      body / range;

    const correctDirection =
      direction === "LONG"
        ? isBullishCandle(candle)
        : isBearishCandle(candle);

    const detected =
      correctDirection &&
      bodyMultiple >= 1.5 &&
      bodyRatio >= 0.40;

    if (detected) {
      return {
        detected: true,
        direction,
        candle,
        bodyMultiple: Number(
          bodyMultiple.toFixed(2)
        ),
        bodyRatio: Number(
          bodyRatio.toFixed(2)
        )
      };
    }
  }

  const latest =
    candles.at(-1);

  return {
    detected: false,
    direction,
    candle: latest,
    bodyMultiple: 0,
    bodyRatio: 0
  };
}

/*
 * ---------------------------------------------------------
 * BOS
 * ---------------------------------------------------------
 *
 * Simple execution-timeframe confirmation.
 *
 * LONG:
 * latest closed candle closes above the previous local high.
 *
 * SHORT:
 * latest closed candle closes below the previous local low.
 */

function detectBOS(tf, direction) {
  const candles = closedCandles(tf);

  if (candles.length < 5) {
    return {
      detected: false,
      direction
    };
  }

  const displacementCandle =
    tf?.displacement?.candle || candles.at(-1);

  const displacementTime =
    Date.parse(displacementCandle?.openTime);

  if (!Number.isFinite(displacementTime)) {
    return {
      detected: false,
      direction
    };
  }

  const sweepCandle = tf?.sweep?.candle;
  const sweepTime = Date.parse(sweepCandle?.openTime);

  if (!Number.isFinite(sweepTime)) {
    return {
      detected: false,
      direction
    };
  }

  /*
   * BOS structure:
   *
   * sweep
   *   ↓
   * post-sweep structure
   *   ↓
   * displacement
   *   ↓
   * latest close breaks that structure
   */

  const structureCandles = candles.filter(c => {
    const time = Date.parse(c?.openTime);

    return (
      Number.isFinite(time) &&
      time > sweepTime &&
      time < displacementTime
    );
  });

  if (structureCandles.length === 0) {
    return {
      detected: false,
      direction,
      reason: "No post-sweep structure before displacement"
    };
  }

  let level = null;

  if (direction === "LONG") {
    level = Math.max(
      ...structureCandles
        .map(c => finite(c?.high))
        .filter(x => x !== null)
    );
  } else {
    level = Math.min(
      ...structureCandles
        .map(c => finite(c?.low))
        .filter(x => x !== null)
    );
  }

  const latest = candles.at(-1);
  const close = finite(latest?.close);

  if (level === null || close === null) {
    return {
      detected: false,
      direction,
      level,
      candle: latest
    };
  }

  const detected =
    direction === "LONG"
      ? close > level
      : close < level;

  return {
    detected,
    direction,
    level,
    candle: latest
  };
}
/*
 * ---------------------------------------------------------
 * EXECUTION
 * ---------------------------------------------------------
 *
 * Swing/day-trading execution:
 *
 * 1H  = directional structure
 * 30M = setup / POI
 * 15M = entry confirmation
 *
 * No 5M.
 * No 1M.
 */


function calculateEntryZone(
  direction,
  price,
  poi,
  confirmation
) {
  const sweepCandle = confirmation?.sweep?.candle;
  const bosCandle = confirmation?.bos?.candle;

  if (!sweepCandle || !bosCandle) {
    return null;
  }

  const sweepHigh = finite(sweepCandle.high);
  const sweepLow = finite(sweepCandle.low);
  const bosClose = finite(bosCandle.close);

  if (
    sweepHigh === null ||
    sweepLow === null ||
    bosClose === null
  ) {
    return null;
  }

  /*
   * Entry is based on the confirmed 15M move,
   * not blindly on current market price.
   *
   * LONG:
   * Use the midpoint between the sweep low and
   * bullish BOS close as the preferred retracement area.
   *
   * SHORT:
   * Use the midpoint between the bearish BOS close
   * and sweep high.
   */

  if (direction === "LONG") {
    const low = Math.min(sweepLow, bosClose);
    const high = Math.max(sweepLow, bosClose);
    const midpoint = low + ((high - low) * 0.5);

    return {
      direction,

      low,
high,
preferred: midpoint,
trigger: bosClose

    };
  }

  const low = Math.min(bosClose, sweepHigh);
  const high = Math.max(bosClose, sweepHigh);
  const midpoint = low + ((high - low) * 0.5);

  return {
    direction,

    low,
high,
preferred: midpoint,
trigger: bosClose

  };
}


function calculateTradeLevels(
  direction,
  entry,
  confirmation,
  snapshot
) {
  const sweepCandle =
    confirmation?.sweep?.candle;

  if (!sweepCandle) {
    return null;
  }

  const sweepHigh =
    finite(sweepCandle.high);

  const sweepLow =
    finite(sweepCandle.low);

  if (
    sweepHigh === null ||
    sweepLow === null ||
    entry === null
  ) {
    return null;
  }

  /*
   * Stop goes beyond the liquidity sweep.
   *
   * Small buffer prevents the stop sitting exactly
   * on the swept liquidity level.
   */

  const range =
    Math.abs(sweepHigh - sweepLow);

  if (!Number.isFinite(range) || range <= 0) {
    return null;
  }

  const buffer =
    range * 0.10;

  let stop;

  if (direction === "LONG") {
    stop = sweepLow - buffer;
  } else {
    stop = sweepHigh + buffer;
  }

  /*
   * First target:
   * nearest meaningful liquidity in the direction
   * of the trade.
   */

  const liquidityTarget =
    getLiquidityTarget(
      snapshot,
      direction,
      entry
    );

  let target = liquidityTarget;

  /*
   * If liquidity target is unusable or gives poor reward,
   * use a minimum 2R objective.
   */

  const risk =
    Math.abs(entry - stop);

  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const minimumTarget =
    direction === "LONG"
      ? entry + (risk * 2)
      : entry - (risk * 2);

  if (
    target === null ||
    !Number.isFinite(target)
  ) {
    target = minimumTarget;
  }

  const reward =
    Math.abs(target - entry);

  const rr =
    calculateRR(
      entry,
      stop,
      target
    );

  /*
   * Reject setups where the nearest liquidity
   * doesn't provide at least 1.5R.
   */

  if (
    rr === null ||
    rr < 1.5
  ) {
    target = minimumTarget;
  }

  const finalRR =
    calculateRR(
      entry,
      stop,
      target
    );

  return {
    entry,
    stop,
    target,
    risk,
    reward: Number(
      Math.abs(target - entry).toFixed(2)
    ),
    rr: finalRR
  };
}


function buildConfirmedTrade(
  snapshot,
  direction,
  poi,
  confirmation
) {
  const entryZone =
    calculateEntryZone(
      direction,
      snapshot.currentPrice,
      poi,
      confirmation
    );

  if (!entryZone) {
    return {
      status: "WAIT",
      reason: [
        "Confirmation detected",
        "Unable to calculate a valid entry zone"
      ]
    };
  }

  const trade =
    calculateTradeLevels(
      direction,
      entryZone.preferred,
      confirmation,
      snapshot
    );

  if (!trade) {
    return {
      status: "WAIT",
      reason: [
        "Confirmation detected",
        "Unable to calculate safe trade levels"
      ]
    };
  }

  if (
    !trade.rr ||
    trade.rr < 1.5
  ) {
    return {
      status: "WAIT",
      reason: [
        "Setup confirmed",
        "Risk/reward is below minimum threshold"
      ]
    };
  }

  return {
    status: "ENTRY_CONFIRMED",
    direction,
    entryZone,
    trade,
    reason: [
      "15M liquidity sweep confirmed",
      "15M displacement confirmed",
      "15M BOS confirmed",
      "Trade levels calculated",
      `Risk/reward: ${trade.rr}R`
    ]
  };
}


function getExecution(
  snapshot,
  direction,
  poi
) {
  const m15 = snapshot.timeframes?.["15m"];
  const price = finite(snapshot.currentPrice);

  if (!m15 || !poi || price === null) {
    return {
      required: true,
      status: "NOT_READY",
      reason: [
        "Missing 15M execution timeframe or POI"
      ]
    };
  }

  const candles = closedCandles(m15);

  if (candles.length < 8) {
    return {
      required: true,
      status: "NOT_READY",
      price,
      poi,
      reason: [
        "Not enough closed 15M candles for execution"
      ]
    };
  }

  let poiTouchIndex = -1;

  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    const high = finite(candle?.high);
    const low = finite(candle?.low);

    if (high === null || low === null) {
      continue;
    }

    if (
      high >= poi.low &&
      low <= poi.high
    ) {
      poiTouchIndex = i;
      break;
    }
  }

  if (poiTouchIndex === -1) {
    return {
      required: true,
      status: "WAITING_FOR_POI",
      price,
      poi,
      reason: [
        "Waiting for price to touch the POI"
      ]
    };
  }

  const touchedCandle = candles[poiTouchIndex];

  /*
   * The sweep may happen as part of the POI reaction.
   * We therefore start execution from the POI creation,
   * while still requiring the POI to have been touched.
   */

  const poiCreatedTime = Date.parse(poi.createdAt);

  let executionStartIndex = poiTouchIndex;

  if (Number.isFinite(poiCreatedTime)) {
    const createdIndex = candles.findIndex(
      c => Date.parse(c?.openTime) >= poiCreatedTime
    );

    if (createdIndex !== -1) {
      executionStartIndex = Math.min(
        createdIndex,
        poiTouchIndex
      );
    }
  }

  const executionCandles =
    candles.slice(executionStartIndex);

  if (executionCandles.length < 3) {
    return {
      required: true,
      status: "WAITING_FOR_SWEEP",
      price,
      poi,
      touchedCandle,
      reason: [
        "POI has been touched",
        "Waiting for 15M liquidity sweep"
      ]
    };
  }

  const executionTf = {
    ...m15,
    candles: executionCandles
  };

  const sweep = detectSweep(
    executionTf,
    direction
  );

  if (!sweep.detected) {
    return {
      required: true,
      status: "WAITING_FOR_SWEEP",
      price,
      poi,
      touchedCandle,
      sweep,
      reason: [
        "POI has been touched",
        "Waiting for 15M liquidity sweep"
      ]
    };
  }

  /*
   * Displacement must occur after the sweep.
   */

  const sweepIndex = executionCandles.findIndex(
    c =>
      c?.openTime === sweep?.candle?.openTime
  );

  const postSweepCandles =
    sweepIndex >= 0
      ? executionCandles.slice(sweepIndex)
      : executionCandles;

  const postSweepTf = {
    ...m15,
    candles: postSweepCandles,
    closedCandleData: postSweepCandles
  };

  const displacement = detectDisplacement(
    postSweepTf,
    direction
  );

    postSweepTf.displacement = displacement;

  if (!displacement.detected) {
    return {
      required: true,
      status: "WAITING_FOR_DISPLACEMENT",
      price,
      poi,
      touchedCandle,
      sweep,
      displacement,
      reason: [
        "15M liquidity sweep confirmed",
        "Waiting for 15M displacement"
      ]
    };
  }

  const bosTf = {
    ...m15,
    sweep,
    displacement
  };

  const bos = detectBOS(
    bosTf,
    direction
  );

  if (!bos.detected) {
    return {
      required: true,
      status: "WAITING_FOR_BOS",
      price,
      poi,
      touchedCandle,
      sweep,
      displacement,
      bos,
      reason: [
        "15M displacement confirmed",
        "Waiting for 15M break of structure"
      ]
    };
  }

  const confirmation = {
    sweep,
    displacement,
    bos
  };

  const confirmedTrade = buildConfirmedTrade(
    snapshot,
    direction,
    poi,
    confirmation
  );

  return {
    required: true,
    price,
    poi,
    touchedCandle,
    sweep,
    displacement,
    bos,
    ...confirmedTrade
  };
}

function buildLongPlan(
  snapshot,
  price,
  bias
) {
  const reason = [
    `${bias.bullishCount}/3 higher-timeframe structures bullish`
  ];

  const poi =
    findPOI(
      snapshot,
      "LONG",
      price
    );

  if (!poi) {
    return {
      direction: "WAIT",
      status: "WAIT",
      execution: {
        required: true,
        status: "NO_POI"
      },
      reason: [
        ...reason,
        "No confirmed bullish POI below price"
      ]
    };
  }

  reason.push(
    `Bullish FVG identified on ${poi.timeframe}`
  );

  const target =
    getLiquidityTarget(
      snapshot,
      "LONG",
      price
    );

  if (!target) {
    return {
      direction: "LONG",
      status: "WAIT",
      entryZone: poi,
      execution: {
        required: true,
        status: "NO_TARGET"
      },
      reason: [
        ...reason,
        "No valid upside liquidity target"
      ]
    };
  }

  reason.push(
    "Upside liquidity identified"
  );

  const execution =
    getExecution(
      snapshot,
      "LONG",
      poi
    );

  const confirmed =
    execution.status === "ENTRY_CONFIRMED";

  return {
    direction: "LONG",
    status: confirmed ? "SETUP" : "WAIT",
    entryZone: poi,

    entry: confirmed
      ? execution.trade?.entry ?? null
      : null,

    stop: confirmed
      ? execution.trade?.stop ?? null
      : null,

    target: confirmed
      ? execution.trade?.target ?? null
      : null,

    riskReward: confirmed
      ? execution.trade?.rr ?? null
      : null,

    execution,

    reason: [
      ...reason,
      ...execution.reason
    ]
  };
}

function buildShortPlan(
  snapshot,
  price,
  bias
) {
  const reason = [
    `${bias.bearishCount}/3 higher-timeframe structures bearish`
  ];

  const poi =
    findPOI(
      snapshot,
      "SHORT",
      price
    );

  if (!poi) {
    return {
      direction: "WAIT",
      status: "WAIT",
      execution: {
        required: true,
        status: "NO_POI"
      },
      reason: [
        ...reason,
        "No confirmed bearish POI above price"
      ]
    };
  }

  reason.push(
    `Bearish FVG identified on ${poi.timeframe}`
  );

  const target =
    getLiquidityTarget(
      snapshot,
      "SHORT",
      price
    );

  if (!target) {
    return {
      direction: "SHORT",
      status: "WAIT",
      entryZone: poi,
      execution: {
        required: true,
        status: "NO_TARGET"
      },
      reason: [
        ...reason,
        "No valid downside liquidity target"
      ]
    };
  }

  reason.push(
    "Downside liquidity identified"
  );

  const execution =
    getExecution(
      snapshot,
      "SHORT",
      poi
    );

  const confirmed =
    execution.status === "ENTRY_CONFIRMED";

  return {
    direction: "SHORT",
    status: confirmed ? "SETUP" : "WAIT",
    entryZone: poi,

    entry: confirmed
      ? execution.trade?.entry ?? null
      : null,

    stop: confirmed
      ? execution.trade?.stop ?? null
      : null,

    target: confirmed
      ? execution.trade?.target ?? null
      : null,

    riskReward: confirmed
      ? execution.trade?.rr ?? null
      : null,

    execution,

    reason: [
      ...reason,
      ...execution.reason
    ]
  };
}
/*
 * ---------------------------------------------------------
 * PUBLIC TRADE PLAN
 * ---------------------------------------------------------
 */

function buildTradePlan(snapshot) {
  const price =
    finite(snapshot?.currentPrice);

  if (price === null) {
    throw new Error(
      "Invalid market price"
    );
  }

  const bias =
    getBias(snapshot);

  let plan;

  if (bias.bias === "bullish") {
    plan =
      buildLongPlan(
        snapshot,
        price,
        bias
      );
  } else if (
    bias.bias === "bearish"
  ) {
    plan =
      buildShortPlan(
        snapshot,
        price,
        bias
      );
  } else {
    plan = {
      direction: "WAIT",
      status: "WAIT",
      execution: {
        required: false,
        status: "NO_BIAS"
      },
      reason: [
        "Higher-timeframe structure is mixed"
      ]
    };
  }

  return {
    symbol: snapshot.symbol,
    price,

    bias: bias.bias,

    direction:
      plan.direction || "WAIT",

    status:
      plan.status || "WAIT",

    entryZone:
      plan.entryZone || null,

    entry:
      plan.entry ?? null,

    stop:
      plan.stop ?? null,

    target:
      plan.target ?? null,

    riskReward:
      plan.riskReward ?? null,

    poiTimeframe:
      plan.entryZone?.timeframe || null,

    execution:
      plan.execution || {
        required: false,
        status: "NOT_ACTIVE"
      },

    reason:
      plan.reason || [],

    generatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  getLiquidityTarget,
  buildTradePlan,
  getBias,
  findPOI,
  getExecution,
  detectSweep,
  detectDisplacement,
  detectBOS
};
