"use strict";

const https = require("https");

const BYBIT_BASE_URL = "https://api.bybit.com";
const CATEGORY = "linear";

const TIMEFRAMES = Object.freeze({
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "30m": 30 * 60 * 1000,
});

const INTERVALS = Object.freeze({
  "1w": "W",
  "1d": "D",
  "4h": "240",
  "1h": "60",
  "30m": "30",
});

const LIMIT = 200;

function requestJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${BYBIT_BASE_URL}${path}`,
      {
        headers: {
          "User-Agent": "KitSetups-TradingEngine/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Bybit HTTP ${res.statusCode}: ${body.slice(0, 300)}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid Bybit JSON response: ${error.message}`));
          }
        });
      },
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error("Bybit request timeout"));
    });

    req.on("error", reject);
  });
}

function toCandle(row) {
  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    turnover: Number(row[6]),
    isClosed: true,
  };
}

function validateCandle(candle) {
  return (
    Number.isFinite(candle.openTime) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.high >= candle.low &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close)
  );
}

async function fetchCandles(symbol, timeframe) {
  const interval = INTERVALS[timeframe];

  if (!interval) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const response = await requestJson(
    `/v5/market/kline?category=${CATEGORY}` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&interval=${interval}` +
      `&limit=${LIMIT}`,
  );

  if (response?.retCode !== 0) {
    throw new Error(
      `Bybit kline error for ${symbol} ${timeframe}: ` +
        `${response?.retMsg || "unknown error"}`,
    );
  }

  const rows = response?.result?.list;

  if (!Array.isArray(rows)) {
    throw new Error(`Invalid candle payload for ${symbol} ${timeframe}`);
  }

  const timeframeMs = TIMEFRAMES[timeframe];

  return rows
    .map(toCandle)
    .map((candle) => ({ ...candle, timeframeMs }))
    .filter(validateCandle)
    .filter((candle) => candle.openTime + timeframeMs <= Date.now())
    .sort((a, b) => a.openTime - b.openTime)
    .map(({ timeframeMs: _unused, ...candle }) => candle);
}

async function fetchTicker(symbol) {
  const response = await requestJson(
    `/v5/market/tickers?category=${CATEGORY}` +
      `&symbol=${encodeURIComponent(symbol)}`,
  );

  if (response?.retCode !== 0) {
    throw new Error(
      `Bybit ticker error for ${symbol}: ` +
        `${response?.retMsg || "unknown error"}`,
    );
  }

  const ticker = response?.result?.list?.[0];

  if (!ticker) {
    throw new Error(`No ticker returned for ${symbol}`);
  }

  return {
    symbol,
    lastPrice: Number(ticker.lastPrice),
    change24hPercent: Number(ticker.price24hPcnt) * 100,
    high24h: Number(ticker.highPrice24h),
    low24h: Number(ticker.lowPrice24h),
    volume24h: Number(ticker.volume24h),
    turnover24h: Number(ticker.turnover24h),
    openInterest: Number(ticker.openInterest || 0),
    fundingRate: Number(ticker.fundingRate || 0),
  };
}

async function getMarketData(symbol) {
  if (!symbol) {
    throw new Error("symbol is required");
  }

  const timeframes = {};

  for (const timeframe of Object.keys(INTERVALS)) {
    timeframes[timeframe] = {
      candles: await fetchCandles(symbol, timeframe),
    };
  }

  const ticker = await fetchTicker(symbol);

  return {
    symbol,
    ticker,
    timeframes,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  TIMEFRAMES,
  INTERVALS,
  fetchCandles,
  fetchTicker,
  getMarketData,
};
