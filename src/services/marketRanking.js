"use strict";

const https = require("https");

const BYBIT_BASE_URL = "https://api.bybit.com";
const TOP_LIMIT = 200;

function httpGet(baseUrl, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${baseUrl}${path}`,
      {
        headers: {
          "User-Agent": "KitSetups/1.0",
          Accept: "application/json",
          ...headers,
        },
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          let json;

          try {
            json = JSON.parse(body);
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
            return;
          }

          if (res.statusCode !== 200) {
            const error = new Error(
              `HTTP ${res.statusCode}: ${body.slice(0, 300)}`,
            );
            error.statusCode = res.statusCode;
            reject(error);
            return;
          }

          resolve(json);
        });
      },
    );

    req.setTimeout(30000, () => {
      req.destroy(new Error("Market ranking request timeout"));
    });

    req.on("error", reject);
  });
}

async function fetchBybitInstruments() {
  const instruments = [];
  let cursor = "";

  do {
    const path =
      `/v5/market/instruments-info` +
      `?category=linear` +
      `&status=Trading` +
      `&limit=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

    const response = await httpGet(BYBIT_BASE_URL, path);

    if (response?.retCode !== 0) {
      throw new Error(response?.retMsg || "Bybit instruments request failed");
    }

    instruments.push(...(response.result?.list || []));
    cursor = response.result?.nextPageCursor || "";
  } while (cursor);

  return instruments.filter(
    (item) =>
      item.contractType === "LinearPerpetual" &&
      item.quoteCoin === "USDT" &&
      item.status === "Trading" &&
      item.baseCoin &&
      item.symbol,
  );
}

async function fetchBybitTickers() {
  const response = await httpGet(
    BYBIT_BASE_URL,
    "/v5/market/tickers?category=linear",
  );

  if (response?.retCode !== 0) {
    throw new Error(response?.retMsg || "Bybit tickers request failed");
  }

  return response.result?.list || [];
}

function percentileScore(value, values) {
  if (!Number.isFinite(value) || !values.length) return 0;

  const sorted = [...values]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return 0;

  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] <= value) low = mid + 1;
    else high = mid;
  }

  return (low / sorted.length) * 100;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function calculateVolatility(ticker) {
  const change = Math.abs(Number(ticker.price24hPcnt || 0)) * 100;
  const turnover = Number(ticker.turnover24h || 0);
  const movementScore = clamp(change * 8);
  const liquidityBonus = turnover > 0
    ? clamp(Math.log10(turnover + 1) * 8, 0, 20)
    : 0;

  return clamp(movementScore + liquidityBonus);
}

function rankMarkets(instruments, tickers) {
  const tickerMap = new Map(
    tickers
      .filter((ticker) => ticker?.symbol)
      .map((ticker) => [ticker.symbol, ticker]),
  );

  const excluded = new Set([
    "USDT",
    "USDC",
    "DAI",
    "FDUSD",
    "TUSD",
    "USDE",
    "USDD",
  ]);

  const candidates = [];

  for (const instrument of instruments) {
    const ticker = tickerMap.get(instrument.symbol);
    if (!ticker) continue;

    const turnover = Number(ticker.turnover24h || 0);
    const lastPrice = Number(ticker.lastPrice || 0);
    const base = String(instrument.baseCoin || "").toUpperCase();

    if (excluded.has(base)) continue;
    if (!Number.isFinite(turnover) || turnover <= 0) continue;
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

    const bid = Number(ticker.bid1Price || 0);
    const ask = Number(ticker.ask1Price || 0);

    candidates.push({
      symbol: instrument.symbol,
      baseCoin: base,
      marketCap: 0,
      marketCapRank: 0,
      turnover24h: turnover,
      volume24h: Number(ticker.volume24h || 0),
      openInterest: Number(ticker.openInterest || 0),
      lastPrice,
      price24hPcnt: Number(ticker.price24hPcnt || 0),
      fundingRate: Number(ticker.fundingRate || 0),
      bid,
      ask,
    });
  }

  const turnoverValues = candidates.map((item) => item.turnover24h);
  const openInterestValues = candidates.map((item) => item.openInterest);

  const ranked = candidates.map((item) => {
    const liquidityScore = percentileScore(item.turnover24h, turnoverValues);
    const volatilityScore = calculateVolatility(item);
    const derivativesScore = percentileScore(item.openInterest, openInterestValues);
    const tradabilityScore =
      item.bid > 0 && item.ask > 0
        ? clamp(100 - (Math.abs(item.ask - item.bid) / item.lastPrice) * 100000)
        : 0;

    // Bybit is now the complete source of truth. We intentionally do not
    // depend on CoinGecko market-cap data or an API key for ranking.
    const qualityScore =
      liquidityScore * 0.45 +
      volatilityScore * 0.20 +
      derivativesScore * 0.25 +
      tradabilityScore * 0.10;

    return {
      ...item,
      scores: {
        marketCap: 0,
        liquidity: Number(liquidityScore.toFixed(2)),
        volatility: Number(volatilityScore.toFixed(2)),
        derivatives: Number(derivativesScore.toFixed(2)),
        tradability: Number(tradabilityScore.toFixed(2)),
        quality: Number(qualityScore.toFixed(2)),
      },
    };
  });

  ranked.sort((a, b) => b.scores.quality - a.scores.quality);

  return ranked.slice(0, TOP_LIMIT).map((item, index) => ({
    rank: index + 1,
    ...item,
  }));
}

async function buildMarketRanking() {
  console.log("📊 Building KitSetups market ranking from Bybit...");

  const [instruments, tickers] = await Promise.all([
    fetchBybitInstruments(),
    fetchBybitTickers(),
  ]);

  const rankedMarkets = rankMarkets(instruments, tickers);
  const dailyLeader = rankedMarkets[0] || null;

  console.log(`🏆 Ranked ${rankedMarkets.length} Bybit markets`);

  if (dailyLeader) {
    console.log(
      `🥇 ${dailyLeader.symbol} — Quality ${dailyLeader.scores.quality}`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    universe: instruments.length,
    rankedMarkets,
    dailyLeader,
    source: "bybit",
  };
}

module.exports = {
  buildMarketRanking,
  rankMarkets,
};
