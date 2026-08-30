const https = require("https");
const dns = require("dns");
const { analyzeTimeframe } = require("./analysis");

const BASE_URL = "https://api.bytick.com";

const INTERVAL_MS = {
  "1": 60_000,
  "5": 5 * 60_000,
  "15": 15 * 60_000,
  "30": 30 * 60_000,
  "60": 60 * 60_000,
  "240": 4 * 60 * 60_000,
  "D": 24 * 60 * 60_000,
  "W": 7 * 24 * 60 * 60_000
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REQUEST_CONCURRENCY = 6;
const REQUEST_SPACING_MS = 100;
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_MAX_ATTEMPTS = 2;

let activeRequests = 0;
let lastRequestAt = 0;
const requestQueue = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runNextRequest() {
  if (
    activeRequests >= REQUEST_CONCURRENCY ||
    requestQueue.length === 0
  ) {
    return;
  }

  const job = requestQueue.shift();

  activeRequests++;

  const waitForSpacing =
    Math.max(
      0,
      REQUEST_SPACING_MS -
        (Date.now() - lastRequestAt)
    );

  setTimeout(async () => {
    lastRequestAt = Date.now();

    try {
      const result =
        await performRequest(
          job.path,
          job.attempt
        );

      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      activeRequests--;

      runNextRequest();
    }
  }, waitForSpacing);
}

function requestJson(
  path,
  attempt = 1
) {
  return new Promise(
    (resolve, reject) => {
      requestQueue.push({
        path,
        attempt,
        resolve,
        reject
      });

      runNextRequest();
    }
  );
}

function performRequest(
  path,
  attempt = 1
) {
  return new Promise(
    (resolve, reject) => {

      const req =
        https.get(
          `${BASE_URL}${path}`,
          {
            headers: {
              "User-Agent": "KitSetups/1.0",
              "Accept": "application/json"
            }
          },
          res => {

            let data = "";

            res.on(
              "data",
              chunk => {
                data += chunk;
              }
            );

            res.on(
              "end",
              async () => {

                if (
                  res.statusCode < 200 ||
                  res.statusCode >= 300
                ) {

                  const error =
                    new Error(
                      `Bybit HTTP ${res.statusCode}: ${data}`
                    );

                  if (
                    attempt < REQUEST_MAX_ATTEMPTS
                  ) {

                    console.log(
                      `⚠️ Bybit HTTP ${res.statusCode}. ` +
                      `Retry ${attempt + 1}/${REQUEST_MAX_ATTEMPTS}`
                    );

                    await sleep(
                      attempt * 1000
                    );

                    try {

                      resolve(
                        await requestJson(
                          path,
                          attempt + 1
                        )
                      );

                    } catch (retryError) {

                      reject(
                        retryError
                      );

                    }

                    return;
                  }

                  reject(error);
                  return;
                }

                try {

                  const json =
                    JSON.parse(data);

                  if (
                    json.retCode !== 0
                  ) {

                    reject(
                      new Error(
                        `Bybit API ${json.retCode}: ${json.retMsg}`
                      )
                    );

                    return;
                  }

                  resolve(
                    json.result
                  );

                } catch {

                  reject(
                    new Error(
                      "Invalid JSON returned by Bybit."
                    )
                  );
                }
              }
            );
          }
        );

      req.setTimeout(
        REQUEST_TIMEOUT_MS,
        () => {

          const error =
            new Error(
              "Bybit request timed out."
            );

          error.code =
            "ETIMEDOUT";

          req.destroy(error);
        }
      );

      req.on(
        "error",
        async error => {

          const retryable =
            [
              "ECONNRESET",
              "ETIMEDOUT",
              "EAI_AGAIN",
              "ECONNREFUSED"
            ].includes(
              error.code
            ) ||
            error.message?.includes(
              "timed out"
            );

          if (
            retryable &&
            attempt < REQUEST_MAX_ATTEMPTS
          ) {

            console.log(
              `⚠️ Bybit connection failed ` +
              `(${error.code || error.message}). ` +
              `Retry ${attempt + 1}/${REQUEST_MAX_ATTEMPTS}`
            );

            await sleep(
              attempt * 1000
            );

            try {

              resolve(
                await requestJson(
                  path,
                  attempt + 1
                )
              );

            } catch (retryError) {

              reject(
                retryError
              );
            }

            return;
          }

          reject(error);
        }
      );
    }
  );
}

async function getServerTime() {
  const result =
    await requestJson("/v5/market/time");

  return Number(result.timeNano)
    ? Math.floor(Number(result.timeNano) / 1e6)
    : Number(result.timeSecond) * 1000;
}

async function getAllPairs() {
  const result = await requestJson(
    "/v5/market/instruments-info?category=linear&limit=1000"
  );

  return (result.list || [])
    .filter(
      x =>
        x.status === "Trading" &&
        x.quoteCoin === "USDT" &&
        x.contractType === "LinearPerpetual"
    )
    .map(x => x.symbol);
}

async function getRankedPairs(limit = 100) {
  const result = await requestJson(
    "/v5/market/tickers?category=linear"
  );

  const pairs = (result.list || [])
    .filter(ticker => {
      return (
        ticker.symbol?.endsWith("USDT") &&
        Number(ticker.lastPrice) > 0 &&
        Number(ticker.turnover24h) > 0 &&
        Number(ticker.volume24h) > 0
      );
    })
    .map(ticker => {
      const high = Number(ticker.highPrice24h);
      const low = Number(ticker.lowPrice24h);
      const price = Number(ticker.lastPrice);
      const turnover = Number(ticker.turnover24h);
      const volume = Number(ticker.volume24h);
      const openInterestValue =
        Number(ticker.openInterestValue) || 0;

      const volatility =
        price > 0 && high > low
          ? ((high - low) / price) * 100
          : 0;

      return {
        symbol: ticker.symbol,
        price,
        turnover,
        volume,
        openInterestValue,
        volatility
      };
    })
    .sort((a, b) => {
      const aScore =
        Math.log10(a.turnover + 1) * 4 +
        Math.log10(a.volume + 1) * 2 +
        Math.log10(a.openInterestValue + 1) * 2 +
        a.volatility * 3;

      const bScore =
        Math.log10(b.turnover + 1) * 4 +
        Math.log10(b.volume + 1) * 2 +
        Math.log10(b.openInterestValue + 1) * 2 +
        b.volatility * 3;

      return bScore - aScore;
    })
    .slice(0, limit);

  return pairs;
}

async function getTicker(
  symbol = "BTCUSDT"
) {
  const result = await requestJson(
    `/v5/market/tickers?category=linear&symbol=${symbol}`
  );

  const ticker = result.list?.[0];

  if (!ticker) {
    throw new Error(
      `No ticker data found for ${symbol}`
    );
  }

  return {
    symbol: ticker.symbol,

    lastPrice: Number(ticker.lastPrice),

    indexPrice: Number(ticker.indexPrice),

    markPrice: Number(ticker.markPrice),

    previous24h: Number(ticker.prevPrice24h),

    change24hPercent:
      Number(ticker.price24hPcnt) * 100,

    high24h: Number(ticker.highPrice24h),

    low24h: Number(ticker.lowPrice24h),

    volume24h: Number(ticker.volume24h),

    turnover24h: Number(ticker.turnover24h),

    openInterest:
      Number(ticker.openInterest),

    openInterestValue:
      Number(ticker.openInterestValue),

    fundingRate:
      Number(ticker.fundingRate),

    nextFundingTime:
      Number(ticker.nextFundingTime),

    bid: Number(ticker.bid1Price),

    ask: Number(ticker.ask1Price),

    timestamp:
      new Date().toISOString()
  };
}

async function getCandles(
  symbol = "BTCUSDT",
  interval = "5",
  limit = 200,
  serverTime = null
) {
  const result = await requestJson(
    `/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
  );

  const now =
    serverTime ?? await getServerTime();

  const duration =
    INTERVAL_MS[interval];

  if (!duration) {
    throw new Error(
      `Unsupported candle interval: ${interval}`
    );
  }

  return (result.list || [])
    .map(candle => {
      const openTimeMs =
        Number(candle[0]);

      const closeTimeMs =
        openTimeMs + duration;

      const isClosed =
        closeTimeMs <= now;

      return {
        openTime:
          new Date(openTimeMs).toISOString(),

        open: Number(candle[1]),

        high: Number(candle[2]),

        low: Number(candle[3]),

        close: Number(candle[4]),

        volume: Number(candle[5]),

        turnover: Number(candle[6]),

        isClosed,

        closeTime:
          new Date(closeTimeMs).toISOString()
      };
    })
    .reverse();
}

async function getMultiTimeframe(
  symbol = "BTCUSDT",
  serverTime = null
) {
  const intervals = {
    "30m": "30",
    "1h": "60",
    "4h": "240"
  };

  const now =
    serverTime ?? await getServerTime();

  const entries =
    Object.entries(intervals);

  const results =
    await Promise.all(
      entries.map(
        async ([name, interval]) => [
          name,
          await getCandles(
            symbol,
            interval,
            200,
            now
          )
        ]
      )
    );

  return Object.fromEntries(results);
}

async function getHigherTimeframes(
  symbol = "BTCUSDT",
  serverTime = null
) {
  const intervals = {
    "1d": "D",
    "1w": "W"
  };

  const now =
    serverTime ?? await getServerTime();

  const result = {};

  for (const [name, interval] of Object.entries(
    intervals
  )) {
    result[name] =
      await getCandles(
        symbol,
        interval,
        200,
        now
      );
  }

  return result;
}

async function getMarketSnapshot(
  symbol = "BTCUSDT"
) {
  const ticker =
    await getTicker(symbol);

  const serverTime =
    await getServerTime();

  const rawTimeframes =
    await getMultiTimeframe(
      symbol,
      serverTime
    );

  const rawHigherTimeframes =
    await getHigherTimeframes(
      symbol,
      serverTime
    );

  const rawTimeframesAll = {
    ...rawTimeframes,
    ...rawHigherTimeframes
  };

  const timeframes =
    Object.fromEntries(
      Object.entries(rawTimeframesAll).map(
        ([name, candles]) => [
          name,
          {
            ...analyzeTimeframe(candles),
            candles
          }
        ]
      )
    );

  return {
    ticker,
    currentPrice: ticker.lastPrice,
    timeframes
  };
}

module.exports = {
  getAllPairs,
  getRankedPairs,
  getTicker,
  getCandles,
  getMultiTimeframe,
  getMarketSnapshot,
  getServerTime
};
