const https = require("https");
const dns = require("dns");
const { analyzeTimeframe } = require("./analysis");

const BASE_URL = "https://api.bybit.com";

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

async function requestJson(path, attempt = 1) {
  const maxAttempts = 5;
  const timeoutMs = 25000;

  return new Promise((resolve, reject) => {
    const req = https.get(
      `${BASE_URL}${path}`,
      {
        headers: {
          "User-Agent": "Nart-Jnr/1.0",
          "Accept": "application/json"
        }
      },
      res => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", async () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              `Bybit HTTP ${res.statusCode}: ${data}`
            );

            if (attempt < maxAttempts) {
              const delay = attempt * 1000;
              console.log(
                `⚠️ Bybit HTTP ${res.statusCode}. Retrying in ${delay}ms...`
              );

              await sleep(delay);

              try {
                resolve(await requestJson(path, attempt + 1));
              } catch (retryError) {
                reject(retryError);
              }

              return;
            }

            reject(error);
            return;
          }

          try {
            const json = JSON.parse(data);

            if (json.retCode !== 0) {
              reject(
                new Error(
                  `Bybit API ${json.retCode}: ${json.retMsg}`
                )
              );
              return;
            }

            resolve(json.result);
          } catch {
            reject(new Error("Invalid JSON returned by Bybit."));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      const error = new Error("Bybit request timed out.");
      error.code = "ETIMEDOUT";
      req.destroy(error);
    });

    req.on("error", async error => {
      const retryable =
        [
          "ECONNRESET",
          "ETIMEDOUT",
          "EAI_AGAIN",
          "ECONNREFUSED"
        ].includes(error.code) ||
        error.message?.includes("timed out");

      if (retryable && attempt < maxAttempts) {
        const delay = attempt * 1000;

        console.log(
          `⚠️ Bybit connection failed (${error.code || error.message}). Retrying in ${delay}ms...`
        );

        await sleep(delay);

        try {
          resolve(await requestJson(path, attempt + 1));
        } catch (retryError) {
          reject(retryError);
        }

        return;
      }

      reject(error);
    });
  });
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
  symbol = "BTCUSDT"
) {
  const intervals = {
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "4h": "240"
  };

  const serverTime =
    await getServerTime();

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
            serverTime
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
    await getMultiTimeframe(symbol);

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
  getTicker,
  getCandles,
  getMultiTimeframe,
  getMarketSnapshot,
  getServerTime
};
