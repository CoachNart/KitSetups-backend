const https = require("https");

const BYBIT_BASE_URL = "https://api.bytick.com";
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

const TOP_LIMIT = 100;

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
          try {
            const json = JSON.parse(body);

            if (res.statusCode !== 200) {
              return reject(
                new Error(
                  `HTTP ${res.statusCode}: ${body.slice(0, 300)}`
                )
              );
            }

            resolve(json);
          } catch (error) {
            reject(
              new Error(
                `Invalid JSON response: ${error.message}`
              )
            );
          }
        });
      }
    );

    req.setTimeout(30000, () => {
      req.destroy(
        new Error("Market ranking request timeout")
      );
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
      (cursor
        ? `&cursor=${encodeURIComponent(cursor)}`
        : "");

    const response =
      await httpGet(
        BYBIT_BASE_URL,
        path
      );

    const list =
      response.result?.list || [];

    instruments.push(...list);

    cursor =
      response.result?.nextPageCursor || "";

  } while (cursor);

  return instruments.filter(
    (item) =>
      item.contractType ===
        "LinearPerpetual" &&
      item.quoteCoin === "USDT" &&
      item.status === "Trading" &&
      item.baseCoin &&
      item.symbol
  );
}

async function fetchBybitTickers() {
  const response =
    await httpGet(
      BYBIT_BASE_URL,
      "/v5/market/tickers?category=linear"
    );

  return response.result?.list || [];
}

async function fetchCoinGeckoMarkets() {
  try {
    const response =
      await httpGet(
        COINGECKO_BASE_URL,
        "/coins/markets" +
          "?vs_currency=usd" +
          "&order=market_cap_desc" +
          "&per_page=250" +
          "&page=1" +
          "&sparkline=false" +
          "&price_change_percentage=24h"
      );

    return Array.isArray(response)
      ? response
      : [];
  } catch (error) {
    console.warn(
      "⚠️ CoinGecko market-cap lookup failed:",
      error.message || error
    );

    return [];
  }
}

function normalizeBaseCoin(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/^1000000/, "")
    .replace(/^100000/, "")
    .replace(/^10000/, "")
    .replace(/^1000/, "")
    .replace(/USDT$/, "");
}

function percentileScore(value, values) {
  if (
    !Number.isFinite(value) ||
    !values.length
  ) {
    return 0;
  }

  const sorted =
    [...values]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (!sorted.length) {
    return 0;
  }

  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const mid =
      Math.floor((low + high) / 2);

    if (sorted[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return (
    (low / sorted.length) * 100
  );
}

function clamp(value, min = 0, max = 100) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function calculateVolatility(ticker) {
  const change =
    Math.abs(
      Number(ticker.price24hPcnt || 0)
    ) * 100;

  const turnover =
    Number(ticker.turnover24h || 0);

  /*
   * Volatility is not simply "biggest move wins".
   *
   * We want enough movement to trade,
   * but not completely dead or abnormal markets.
   */
  const movementScore =
    clamp(change * 8, 0, 100);

  const liquidityBonus =
    turnover > 0
      ? clamp(
          Math.log10(
            turnover + 1
          ) * 8,
          0,
          20
        )
      : 0;

  return clamp(
    movementScore +
      liquidityBonus
  );
}

function calculateLiquidity(
  ticker,
  turnoverValues
) {
  return percentileScore(
    Number(ticker.turnover24h || 0),
    turnoverValues
  );
}

function calculateMarketCap(
  baseCoin,
  coinGeckoMap
) {
  const normalized =
    normalizeBaseCoin(baseCoin);

  const coin =
    coinGeckoMap.get(
      normalized
    );

  return {
    marketCap:
      Number(
        coin?.market_cap || 0
      ),

    marketCapRank:
      Number(
        coin?.market_cap_rank || 0
      ),
  };
}

function buildCoinGeckoMap(
  markets
) {
  const map = new Map();

  for (const coin of markets) {
    if (!coin?.symbol) {
      continue;
    }

    const symbol =
      String(
        coin.symbol
      ).toUpperCase();

    if (!map.has(symbol)) {
      map.set(
        symbol,
        coin
      );
    }
  }

  return map;
}

function calculateMarketCapScore(
  marketCap,
  marketCaps
) {
  if (
    !Number.isFinite(marketCap) ||
    marketCap <= 0
  ) {
    return 0;
  }

  return percentileScore(
    marketCap,
    marketCaps
  );
}

function rankMarkets(
  instruments,
  tickers,
  coinGeckoMarkets
) {
  const tickerMap =
    new Map(
      tickers
        .filter(
          (ticker) =>
            ticker?.symbol
        )
        .map(
          (ticker) => [
            ticker.symbol,
            ticker,
          ]
        )
    );

  const coinGeckoMap =
    buildCoinGeckoMap(
      coinGeckoMarkets
    );

  const candidates = [];

  for (const instrument of instruments) {
    const ticker =
      tickerMap.get(
        instrument.symbol
      );

    if (!ticker) {
      continue;
    }

    const turnover =
      Number(
        ticker.turnover24h || 0
      );

    const lastPrice =
      Number(
        ticker.lastPrice || 0
      );

    if (
      !Number.isFinite(turnover) ||
      turnover <= 0 ||
      !Number.isFinite(lastPrice) ||
      lastPrice <= 0
    ) {
      continue;
    }

    /*
     * Avoid stablecoin-like markets.
     */
    const base =
      String(
        instrument.baseCoin || ""
      ).toUpperCase();

    if (
      new Set([
        "USDT",
        "USDC",
        "DAI",
        "FDUSD",
        "TUSD",
        "USDE",
        "USDD",
      ]).has(base)
    ) {
      continue;
    }

    const {
      marketCap,
      marketCapRank,
    } =
      calculateMarketCap(
        base,
        coinGeckoMap
      );

    candidates.push({
      symbol:
        instrument.symbol,

      baseCoin:
        base,

      marketCap,

      marketCapRank,

      turnover24h:
        turnover,

      volume24h:
        Number(
          ticker.volume24h || 0
        ),

      openInterest:
        Number(
          ticker.openInterest || 0
        ),

      lastPrice,

      price24hPcnt:
        Number(
          ticker.price24hPcnt || 0
        ),

      fundingRate:
        Number(
          ticker.fundingRate || 0
        ),

      bid:
        Number(
          ticker.bid1Price || 0
        ),

      ask:
        Number(
          ticker.ask1Price || 0
        ),

      instrument,
    });
  }

  const turnoverValues =
    candidates.map(
      (item) =>
        item.turnover24h
    );

  const marketCaps =
    candidates
      .map(
        (item) =>
          item.marketCap
      )
      .filter(
        (value) =>
          value > 0
      );

  const openInterestValues =
    candidates.map(
      (item) =>
        item.openInterest
    );

  const ranked =
    candidates.map(
      (item) => {
        const marketCapScore =
          calculateMarketCapScore(
            item.marketCap,
            marketCaps
          );

        const liquidityScore =
          calculateLiquidity(
            item,
            turnoverValues
          );

        const volatilityScore =
          calculateVolatility(
            item
          );

        const derivativesScore =
          percentileScore(
            item.openInterest,
            openInterestValues
          );

        /*
         * Market-quality score.
         *
         * Market cap       25%
         * Liquidity        30%
         * Volatility       20%
         * Derivatives      15%
         * Tradability       10%
         */
        const tradabilityScore =
          item.bid > 0 &&
          item.ask > 0
            ? clamp(
                100 -
                  (
                    Math.abs(
                      item.ask -
                        item.bid
                    ) /
                      item.lastPrice
                  ) *
                    100000
              )
            : 0;

        const qualityScore =
          (
            marketCapScore * 0.25 +
            liquidityScore * 0.30 +
            volatilityScore * 0.20 +
            derivativesScore * 0.15 +
            tradabilityScore * 0.10
          );

        return {
          ...item,

          scores: {
            marketCap:
              Number(
                marketCapScore.toFixed(2)
              ),

            liquidity:
              Number(
                liquidityScore.toFixed(2)
              ),

            volatility:
              Number(
                volatilityScore.toFixed(2)
              ),

            derivatives:
              Number(
                derivativesScore.toFixed(2)
              ),

            tradability:
              Number(
                tradabilityScore.toFixed(2)
              ),

            quality:
              Number(
                qualityScore.toFixed(2)
              ),
          },
        };
      }
    );

  ranked.sort(
    (a, b) =>
      b.scores.quality -
      a.scores.quality
  );

  return ranked
    .slice(0, TOP_LIMIT)
    .map(
      (item, index) => ({
        rank: index + 1,

        symbol:
          item.symbol,

        baseCoin:
          item.baseCoin,

        marketCap:
          item.marketCap,

        marketCapRank:
          item.marketCapRank,

        turnover24h:
          item.turnover24h,

        volume24h:
          item.volume24h,

        openInterest:
          item.openInterest,

        lastPrice:
          item.lastPrice,

        price24hPcnt:
          item.price24hPcnt,

        fundingRate:
          item.fundingRate,

        scores:
          item.scores,
      })
    );
}

async function buildMarketRanking() {
  console.log(
    "📊 Building KitSetups market ranking..."
  );

  const [
    instruments,
    tickers,
    coinGeckoMarkets,
  ] =
    await Promise.all([
      fetchBybitInstruments(),
      fetchBybitTickers(),
      fetchCoinGeckoMarkets(),
    ]);

  const rankedMarkets =
    rankMarkets(
      instruments,
      tickers,
      coinGeckoMarkets
    );

  const dailyLeader =
    rankedMarkets[0] || null;

  console.log(
    `🏆 Ranked ${rankedMarkets.length} markets`
  );

  if (dailyLeader) {
    console.log(
      `🥇 ${dailyLeader.symbol} — ` +
      `Quality ${dailyLeader.scores.quality}`
    );
  }

  return {
    generatedAt:
      new Date().toISOString(),

    universe:
      instruments.length,

    rankedMarkets,

    dailyLeader,
  };
}

module.exports = {
  buildMarketRanking,
  rankMarkets,
};
