"use strict";

/*
 * MARKET CONTEXT
 *
 * Purpose:
 * Establish the directional environment before any setup
 * or entry logic is considered.
 *
 * Timeframe responsibilities:
 *
 * 1W  = macro regime
 * 1D  = primary directional structure
 * 4H  = intermediate confirmation
 * 1H  = trade context
 * 30M = execution environment
 *
 * This module DOES NOT:
 * - create entries
 * - create stops
 * - create targets
 * - calculate RR
 * - publish signals
 *
 * It only describes what the market is doing.
 */

const REQUIRED_TIMEFRAMES = Object.freeze([
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
]);

function validNumber(value) {
  return Number.isFinite(Number(value));
}

function candleRange(candle) {
  return Number(candle.high) - Number(candle.low);
}

function candleBody(candle) {
  return Math.abs(
    Number(candle.close) - Number(candle.open)
  );
}

function averageRange(candles, lookback = 20) {
  const data = candles.slice(-lookback);

  if (!data.length) {
    return null;
  }

  const ranges = data
    .map(candleRange)
    .filter(Number.isFinite);

  if (!ranges.length) {
    return null;
  }

  return (
    ranges.reduce((sum, value) => sum + value, 0) /
    ranges.length
  );
}

function classifyMomentum(candles) {
  if (!Array.isArray(candles) || candles.length < 5) {
    return "neutral";
  }

  const recent = candles.slice(-5);

  let bullish = 0;
  let bearish = 0;

  for (const candle of recent) {
    if (candle.close > candle.open) {
      bullish++;
    } else if (candle.close < candle.open) {
      bearish++;
    }
  }

  if (bullish >= 4) {
    return "bullish";
  }

  if (bearish >= 4) {
    return "bearish";
  }

  return "neutral";
}

function classifyTrend(candles) {
  if (!Array.isArray(candles) || candles.length < 10) {
    return "neutral";
  }

  const recent = candles.slice(-10);

  const firstClose = Number(recent[0].close);
  const lastClose = Number(recent.at(-1).close);

  if (
    !validNumber(firstClose) ||
    !validNumber(lastClose) ||
    firstClose === 0
  ) {
    return "neutral";
  }

  const change =
    (lastClose - firstClose) / firstClose;

  /*
   * Context classification deliberately uses a modest
   * threshold. It describes directional pressure rather
   * than declaring a trade.
   */
  if (change >= 0.015) {
    return "bullish";
  }

  if (change <= -0.015) {
    return "bearish";
  }

  return "neutral";
}

function classifyStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 12) {
    return "unknown";
  }

  const recent = candles.slice(-12);

  const highs = recent.map((c) => Number(c.high));
  const lows = recent.map((c) => Number(c.low));

  const midpoint = Math.floor(recent.length / 2);

  const firstHalfHigh = Math.max(
    ...highs.slice(0, midpoint)
  );

  const secondHalfHigh = Math.max(
    ...highs.slice(midpoint)
  );

  const firstHalfLow = Math.min(
    ...lows.slice(0, midpoint)
  );

  const secondHalfLow = Math.min(
    ...lows.slice(midpoint)
  );

  const higherHigh =
    secondHalfHigh > firstHalfHigh;

  const higherLow =
    secondHalfLow > firstHalfLow;

  const lowerHigh =
    secondHalfHigh < firstHalfHigh;

  const lowerLow =
    secondHalfLow < firstHalfLow;

  if (higherHigh && higherLow) {
    return "bullish";
  }

  if (lowerHigh && lowerLow) {
    return "bearish";
  }

  return "range";
}

function analyzeTimeframe(timeframe, candles) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      timeframe,
      valid: false,
      trend: "unknown",
      structure: "unknown",
      momentum: "unknown",
      averageRange: null,
      lastPrice: null,
    };
  }

  const last = candles.at(-1);

  return {
    timeframe,
    valid: true,
    trend: classifyTrend(candles),
    structure: classifyStructure(candles),
    momentum: classifyMomentum(candles),
    averageRange: averageRange(candles),
    lastPrice: Number(last.close),
  };
}

function determineDirectionalBias(context) {
  const weights = {
    "1w": 4,
    "1d": 4,
    "4h": 3,
    "1h": 2,
    "30m": 1,
  };

  let bullish = 0;
  let bearish = 0;

  for (const timeframe of REQUIRED_TIMEFRAMES) {
    const data = context[timeframe];

    if (!data?.valid) {
      continue;
    }

    const weight = weights[timeframe];

    if (
      data.trend === "bullish" ||
      data.structure === "bullish"
    ) {
      bullish += weight;
    }

    if (
      data.trend === "bearish" ||
      data.structure === "bearish"
    ) {
      bearish += weight;
    }
  }

  if (bullish > bearish) {
    return "bullish";
  }

  if (bearish > bullish) {
    return "bearish";
  }

  return "neutral";
}

function analyzeContext(marketData) {
  if (!marketData?.timeframes) {
    throw new Error(
      "Market data with timeframes is required"
    );
  }

  const context = {};

  for (const timeframe of REQUIRED_TIMEFRAMES) {
    context[timeframe] = analyzeTimeframe(
      timeframe,
      marketData.timeframes[timeframe]?.candles || []
    );
  }

  const bias = determineDirectionalBias(context);

  return {
    bias,

    timeframes: context,

    hierarchy: {
      macro: context["1w"],
      primary: context["1d"],
      intermediate: context["4h"],
      trade: context["1h"],
      execution: context["30m"],
    },

    aligned:
      bias !== "neutral" &&
      context["1w"]?.valid &&
      context["1d"]?.valid &&
      context["4h"]?.valid,

    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  REQUIRED_TIMEFRAMES,
  analyzeContext,
};
