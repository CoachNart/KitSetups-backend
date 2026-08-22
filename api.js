require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const crypto = require("crypto");
const marketEngine = require("./src/tools/marketEngine");

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);

const BNB_RPC =
  process.env.BNB_RPC_URL ||
  "https://bsc-dataseed.binance.org";

const PAYMENT_ADDRESS =
  process.env.NART_PAYMENT_ADDRESS ||
  "0x1c35bf9d920e1b5d7e7e37ce1d15a1b9500f8474";

const PREMIUM_PRICE_USDT =
  Number(process.env.NART_PREMIUM_PRICE_USDT || 55);

const BNB_CHAIN_ID = 56;

const USDT_ADDRESS =
  process.env.NART_USDT_CONTRACT ||
  "0x55d398326f99059fF775485246999027B3197955";

const provider =
  new ethers.JsonRpcProvider(BNB_RPC);

const usdtInterface = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)"
]);

const usdtDecimals = 18;

const SUBSCRIPTIONS_FILE = path.join(
  __dirname,
  "data",
  "subscriptions.json"
);

const AUTH_FILE = path.join(
  __dirname,
  "data",
  "auth.json"
);

const SESSION_COOKIE = "nart_session";

const SESSION_MAX_AGE =
  30 * 24 * 60 * 60 * 1000;

function readAuthStore() {
  try {
    if (!fs.existsSync(AUTH_FILE)) {
      return {
        users: {},
        sessions: {}
      };
    }

    return JSON.parse(
      fs.readFileSync(
        AUTH_FILE,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      "❌ Auth store read error:",
      error.message
    );

    return {
      users: {},
      sessions: {}
    };
  }
}

function writeAuthStore(data) {
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify(data, null, 2)
  );
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return {
    salt,
    hash
  };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}

function createSession(userId) {
  const store = readAuthStore();

  const token =
    crypto.randomBytes(32).toString("hex");

  store.sessions[token] = {
    userId,
    createdAt: Date.now(),
    expiresAt:
      Date.now() + SESSION_MAX_AGE
  };

  writeAuthStore(store);

  return token;
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  for (const part of header.split(";")) {
    const [key, ...rest] =
      part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(
        rest.join("=")
      );
    }
  }

  return null;
}

function getAuthenticatedUserId(req) {
  const token =
    getCookie(
      req,
      SESSION_COOKIE
    );

  if (!token) {
    return null;
  }

  const store = readAuthStore();
  const session = store.sessions[token];

  if (!session) {
    return null;
  }

  if (
    !session.expiresAt ||
    session.expiresAt < Date.now()
  ) {
    delete store.sessions[token];
    writeAuthStore(store);
    return null;
  }

  return session.userId;
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}; SameSite=None; Secure`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}


function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
    });

    req.on("end", () => {
      try {
        resolve(
          data
            ? JSON.parse(data)
            : {}
        );
      } catch (error) {
        reject(
          new Error("Invalid JSON body")
        );
      }
    });

    req.on("error", reject);
  });
}


const PLANS = {
  free: {
    name: "FREE",
    monthlyLimit: 3,
  },

  premium: {
    name: "PREMIUM",
    monthlyLimit: 100,
  },
};

function sendJson(res, status, data, req = null) {
  const body = JSON.stringify(data);

  const origin =
    req?.headers?.origin || "";

  const allowedOrigin =
    origin === "https://kitsetups.vercel.app"
      ? origin
      : "https://kitsetups.vercel.app";

  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type",
    "Vary": "Origin",
  });

  res.end(body);
}

function readSubscriptions() {
  try {
    if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
      return { users: {} };
    }

    return JSON.parse(
      fs.readFileSync(
        SUBSCRIPTIONS_FILE,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      "❌ Subscription store read error:",
      error.message
    );

    return { users: {} };
  }
}

function writeSubscriptions(data) {
  fs.writeFileSync(
    SUBSCRIPTIONS_FILE,
    JSON.stringify(data, null, 2)
  );
}

function getQuery(url) {
  const query = {};

  const index = url.indexOf("?");

  if (index === -1) {
    return query;
  }

  for (const part of url.slice(index + 1).split("&")) {
    const [key, value] = part.split("=");

    if (key) {
      query[decodeURIComponent(key)] =
        decodeURIComponent(value || "");
    }
  }

  return query;
}

function getMonthKey() {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

function getUser(userId) {
  const store = readSubscriptions();

  if (!store.users[userId]) {
    store.users[userId] = {
      id: userId,
      plan: "free",
      monthlyUsage: 0,
      usageMonth: getMonthKey(),
      createdAt: new Date().toISOString(),
    };

    writeSubscriptions(store);
  }

  const user = store.users[userId];

  const currentMonth = getMonthKey();

  if (user.usageMonth !== currentMonth) {
    user.monthlyUsage = 0;
    user.usageMonth = currentMonth;

    writeSubscriptions(store);
  }

  return user;
}

function getPlan(user) {
  return (
    PLANS[user.plan] ||
    PLANS.free
  );
}

function getUserId(req, query) {
  return (
    req.headers["x-nart-user"] ||
    query.user ||
    null
  );
}



function getGoogleRedirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    "http://127.0.0.1:8787/api/auth/google/callback"
  );
}

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || "";
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

function getUiUrl() {
  return (
    process.env.NART_UI_URL ||
    "http://127.0.0.1:3000"
  );
}

async function handleRequest(req, res) {
  const url = req.url || "/";
  const query = getQuery(url);


  /*
   * GOOGLE AUTHENTICATION
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/auth/google")
  ) {
    const clientId = getGoogleClientId();
    const redirectUri = getGoogleRedirectUri();

    if (!clientId) {
      return sendJson(res, 500, {
        ok: false,
        error: "Google OAuth is not configured",
      });
    }

    const state = crypto.randomBytes(24).toString("hex");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      state,
    });

    res.statusCode = 302;
    res.setHeader(
      "Location",
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    );
    res.end();
    return;
  }

  if (
    req.method === "GET" &&
    url.startsWith("/api/auth/google/callback")
  ) {
    try {
      const code = query.code;
      const error = query.error;

      if (error) {
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `${getUiUrl()}?auth=google_error`
        );
        res.end();
        return;
      }

      if (!code) {
        return sendJson(res, 400, {
          ok: false,
          error: "Google authorization code missing",
        });
      }

      const clientId = getGoogleClientId();
      const clientSecret = getGoogleClientSecret();
      const redirectUri = getGoogleRedirectUri();

      if (!clientId || !clientSecret) {
        return sendJson(res, 500, {
          ok: false,
          error: "Google OAuth credentials are missing",
        });
      }

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        }
      );

      const tokenData =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {
        console.error(
          "❌ Google token exchange failed:",
          tokenData
        );

        return sendJson(res, 401, {
          ok: false,
          error: "Google authentication failed",
        });
      }

      const profileResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization:
              `Bearer ${tokenData.access_token}`,
          },
        }
      );

      const profile =
        await profileResponse.json();

      if (
        !profileResponse.ok ||
        !profile.sub ||
        !profile.email
      ) {
        return sendJson(res, 401, {
          ok: false,
          error: "Unable to read Google profile",
        });
      }

      const auth = readAuthStore();

      let user = Object.values(auth.users).find(
        item =>
          item.googleId === profile.sub ||
          item.email ===
            String(profile.email)
              .trim()
              .toLowerCase()
      );

      if (!user) {
        const userId =
          "user_" + crypto.randomUUID();

        user = {
          id: userId,
          email:
            String(profile.email)
              .trim()
              .toLowerCase(),
          displayName:
            profile.name || null,
          photoURL:
            profile.picture || null,
          googleId: profile.sub,
          createdAt:
            new Date().toISOString(),
        };

        auth.users[userId] = user;
      } else {
        user.displayName =
          profile.name ||
          user.displayName ||
          null;

        user.photoURL =
          profile.picture ||
          user.photoURL ||
          null;

        user.googleId =
          profile.sub ||
          user.googleId ||
          null;
      }

      writeAuthStore(auth);

      getUser(user.id);

      const token =
        createSession(user.id);

      setSessionCookie(res, token);

      res.statusCode = 302;
      res.setHeader(
        "Location",
        `${getUiUrl()}?auth=google_success`
      );
      res.end();
      return;

    } catch (error) {
      console.error(
        "❌ Google authentication error:",
        error.stack || error.message
      );

      res.statusCode = 302;
      res.setHeader(
        "Location",
        `${getUiUrl()}?auth=google_error`
      );
      res.end();
      return;
    }
  }


  /*
   * AUTHENTICATION
   */

  if (
    req.method === "POST" &&
    url.startsWith("/api/auth/signup")
  ) {
    try {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const password =
        String(body.password || "");

      if (!email || !email.includes("@")) {
        return sendJson(res, 400, {
          ok: false,
          error: "Enter a valid email address",
        });
      }

      if (password.length < 8) {
        return sendJson(res, 400, {
          ok: false,
          error:
            "Password must be at least 8 characters",
        });
      }

      const auth = readAuthStore();

      const existing =
        Object.values(auth.users).find(
          user => user.email === email
        );

      if (existing) {
        return sendJson(res, 409, {
          ok: false,
          error:
            "An account with this email already exists",
        });
      }

      const userId =
        "user_" + crypto.randomUUID();

      const passwordData =
        hashPassword(password);

      auth.users[userId] = {
        id: userId,
        email,
        passwordHash: passwordData.hash,
        passwordSalt: passwordData.salt,
        createdAt:
          new Date().toISOString(),
      };

      writeAuthStore(auth);

      // Create the matching subscription account.
      getUser(userId);

      const token =
        createSession(userId);

      setSessionCookie(
        res,
        token
      );

      return sendJson(res, 201, {
        ok: true,
        data: {
          id: userId,
          email,
        },
      });

    } catch (error) {
      console.error(
        "❌ Signup error:",
        error.stack || error.message
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to create account",
      });
    }
  }

  if (
    req.method === "POST" &&
    url.startsWith("/api/auth/login")
  ) {
    try {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const password =
        String(body.password || "");

      const auth =
        readAuthStore();

      const user =
        Object.values(auth.users).find(
          item => item.email === email
        );

      if (
        !user ||
        !verifyPassword(
          password,
          user.passwordSalt,
          user.passwordHash
        )
      ) {
        return sendJson(res, 401, {
          ok: false,
          error:
            "Invalid email or password",
        });
      }

      const token =
        createSession(user.id);

      setSessionCookie(
        res,
        token
      );

      return sendJson(res, 200, {
        ok: true,
        data: {
          id: user.id,
          email: user.email,
        },
      });

    } catch (error) {
      console.error(
        "❌ Login error:",
        error.stack || error.message
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to sign in",
      });
    }
  }

  if (
    req.method === "GET" &&
    url.startsWith("/api/auth/me")
  ) {
    const userId =
      getAuthenticatedUserId(req);

    if (!userId) {
      return sendJson(res, 401, {
        ok: false,
        error: "Not authenticated",
      }, req);
    }

    const auth =
      readAuthStore();

    const user =
      auth.users[userId];

    if (!user) {
      return sendJson(res, 401, {
        ok: false,
        error: "Account not found",
      }, req);
    }

    return sendJson(res, 200, {
      ok: true,
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
      },
    }, req);
  }

  if (
    req.method === "POST" &&
    url.startsWith("/api/auth/logout")
  ) {
    const token =
      getCookie(
        req,
        SESSION_COOKIE
      );

    if (token) {
      const auth =
        readAuthStore();

      delete auth.sessions[token];

      writeAuthStore(auth);
    }

    clearSessionCookie(res);

    return sendJson(res, 200, {
      ok: true,
    });
  }


  if (req.method === "OPTIONS") {
    const origin =
      req.headers.origin || "";

    const allowedOrigin =
      origin === "https://kitsetups.vercel.app"
        ? origin
        : "https://kitsetups.vercel.app";

    res.writeHead(204, {
      "Access-Control-Allow-Origin":
        allowedOrigin,
      "Access-Control-Allow-Credentials":
        "true",
      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type",
      "Vary": "Origin",
    });

    return res.end();
  }


  /*
   * HEALTH
   */

  if (
    req.method === "GET" &&
    url.startsWith("/health")
  ) {
    return sendJson(res, 200, {
      ok: true,
      service: "nart-jnr-api",
      timestamp: new Date().toISOString(),
    });
  }

  /*
   * MARKET ANALYSIS
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/analysis")
  ) {
    try {
      const symbol =
        query.symbol || "BTCUSDT";

      console.log(
        `🔎 API analysis request: ${symbol}`
      );

      const result =
        await marketEngine.analyzeMarket(symbol);

      return sendJson(res, 200, {
        ok: true,
        data: result,
      });
    } catch (error) {
      console.error(
        "❌ Analysis API error:",
        error.stack || error.message
      );

      return sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
  }

  /*
   * ACCOUNT
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/account")
  ) {
    const userId =
      getUserId(req, query);

    if (!userId) {
      return sendJson(res, 400, {
        ok: false,
        error: "Missing user identifier",
      });
    }

    const user = getUser(userId);
    const plan = getPlan(user);

    return sendJson(res, 200, {
      ok: true,
      data: {
        id: user.id,
        plan: user.plan,
        planName: plan.name,
        monthlyLimit: plan.monthlyLimit,
        monthlyUsage: user.monthlyUsage,
        remaining:
          Math.max(
            plan.monthlyLimit -
              user.monthlyUsage,
            0
          ),
        usageMonth:
          user.usageMonth,
      },
    });
  }

  /*
   * SUBSCRIPTION
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/subscription")
  ) {
    const userId =
      getUserId(req, query);

    if (!userId) {
      return sendJson(res, 400, {
        ok: false,
        error: "Missing user identifier",
      });
    }

    const user = getUser(userId);
    const plan = getPlan(user);

    return sendJson(res, 200, {
      ok: true,
      data: {
        plan: user.plan,
        name: plan.name,
        monthlyLimit:
          plan.monthlyLimit,
        monthlyUsage:
          user.monthlyUsage,
        remaining:
          Math.max(
            plan.monthlyLimit -
              user.monthlyUsage,
            0
          ),
        active:
          user.plan === "premium",
      },
    });
  }

  /*
   * USAGE
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/usage")
  ) {
    const userId =
      getUserId(req, query);

    if (!userId) {
      return sendJson(res, 400, {
        ok: false,
        error: "Missing user identifier",
      });
    }

    const user = getUser(userId);
    const plan = getPlan(user);

    return sendJson(res, 200, {
      ok: true,
      data: {
        used: user.monthlyUsage,
        limit: plan.monthlyLimit,
        remaining:
          Math.max(
            plan.monthlyLimit -
              user.monthlyUsage,
            0
          ),
        month:
          user.usageMonth,
      },
    });
  }

  /*
   * PREMIUM PAYMENT
   *
   * User sends USDT on BNB Smart Chain.
   * Frontend submits the transaction hash.
   * Server verifies the transaction directly on-chain.
   */

  if (
    req.method === "POST" &&
    url.startsWith("/api/payment/verify")
  ) {
    try {
      const body = await new Promise((resolve, reject) => {
        let raw = "";

        req.on("data", chunk => {
          raw += chunk;

          if (raw.length > 10000) {
            reject(new Error("Request body too large"));
            req.destroy();
          }
        });

        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new Error("Invalid JSON body"));
          }
        });

        req.on("error", reject);
      });

      const userId =
        req.headers["x-nart-user"] ||
        body.user ||
        null;

      const txHash =
        body.txHash ||
        body.transactionHash ||
        null;

      if (!userId) {
        return sendJson(res, 400, {
          ok: false,
          error: "Missing user identifier",
        });
      }

      if (
        !txHash ||
        !ethers.isHexString(txHash, 32)
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: "Invalid transaction hash",
        });
      }

      const store = readSubscriptions();
      const user = getUser(userId);

      /*
       * Prevent the same transaction from being
       * used to activate multiple accounts.
       */
      const alreadyUsed = Object.values(store.users)
        .some(existing =>
          existing.paymentTx === txHash
        );

      if (alreadyUsed) {
        return sendJson(res, 409, {
          ok: false,
          error: "This transaction has already been used",
        });
      }

      console.log(
        `💳 Verifying premium payment: ${txHash}`
      );

      const tx =
        await provider.getTransaction(txHash);

      if (!tx) {
        return sendJson(res, 400, {
          ok: false,
          error: "Transaction not found",
        });
      }

      const network =
        await provider.getNetwork();

      if (
        Number(network.chainId) !== BNB_CHAIN_ID
      ) {
        return sendJson(res, 500, {
          ok: false,
          error: "Payment provider is not connected to BNB Smart Chain",
        });
      }

      const receipt =
        await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return sendJson(res, 400, {
          ok: false,
          error: "Transaction is still pending",
        });
      }

      if (receipt.status !== 1) {
        return sendJson(res, 400, {
          ok: false,
          error: "Transaction failed on-chain",
        });
      }

      /*
       * Only accept transfers from the official
       * BNB Smart Chain USDT contract.
       */
      if (
        tx.to?.toLowerCase() !==
        USDT_ADDRESS.toLowerCase()
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: "Transaction is not a BNB Chain USDT transfer",
        });
      }

      let validTransfer = false;

      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          USDT_ADDRESS.toLowerCase()
        ) {
          continue;
        }

        try {
          const parsed =
            usdtInterface.parseLog({
              topics: log.topics,
              data: log.data,
            });

          if (!parsed || parsed.name !== "Transfer") {
            continue;
          }

          const from =
            parsed.args[0];

          const to =
            parsed.args[1];

          const amount =
            parsed.args[2];

          const expectedAmount =
            ethers.parseUnits(
              String(PREMIUM_PRICE_USDT),
              usdtDecimals
            );

          if (
            to.toLowerCase() ===
              PAYMENT_ADDRESS.toLowerCase() &&
            amount >= expectedAmount
          ) {
            validTransfer = true;
            break;
          }
        } catch {
          // Ignore unrelated logs.
        }
      }

      if (!validTransfer) {
        return sendJson(res, 400, {
          ok: false,
          error:
            `Payment must be at least ${PREMIUM_PRICE_USDT} USDT sent to the KitSetups payment wallet`,
        });
      }

      /*
       * Activate Premium for 30 days.
       */
      const now =
        new Date();

      const expiresAt =
        new Date(
          now.getTime() +
          30 * 24 * 60 * 60 * 1000
        );

      user.plan = "premium";
      user.paymentTx = txHash;
      user.paymentAmount =
        PREMIUM_PRICE_USDT;
      user.paymentNetwork =
        "BNB Smart Chain";
      user.paymentToken = "USDT";
      user.premiumStartedAt =
        now.toISOString();
      user.premiumExpiresAt =
        expiresAt.toISOString();

      writeSubscriptions(store);

      console.log(
        `✅ Premium activated for ${userId}`
      );

      return sendJson(res, 200, {
        ok: true,
        data: {
          userId,
          plan: "premium",
          planName: "PREMIUM",
          payment: {
            token: "USDT",
            network: "BNB Smart Chain",
            amount: PREMIUM_PRICE_USDT,
            transaction: txHash,
          },
          premiumExpiresAt:
            user.premiumExpiresAt,
        },
      });

    } catch (error) {
      console.error(
        "❌ Payment verification error:",
        error.stack || error.message
      );

      return sendJson(res, 500, {
        ok: false,
        error:
          "Unable to verify payment right now",
      });
    }
  }

  /*
   * PAYMENT INFO
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/payment/info")
  ) {
    return sendJson(res, 200, {
      ok: true,
      data: {
        network: "BNB Smart Chain",
        chainId: BNB_CHAIN_ID,
        token: "USDT",
        tokenContract: USDT_ADDRESS,
        amount: PREMIUM_PRICE_USDT,
        wallet: PAYMENT_ADDRESS,
      },
    });
  }

  /*
   * SIGNAL FEED
   *
   * Generate live analysis directly from the market engine.
   * This keeps all existing signal/entry criteria intact.
   */

  if (
    req.method === "GET" &&
    url.startsWith("/api/signals")
  ) {
    try {
      const signalsFile = path.join(
        __dirname,
        "data",
        "signals.json"
      );

      let signals = [];

      if (fs.existsSync(signalsFile)) {
        const store = JSON.parse(
          fs.readFileSync(signalsFile, "utf8")
        );

        if (Array.isArray(store.signals)) {
          signals = store.signals;
        }
      }

      return sendJson(res, 200, {
        ok: true,
        data: {
          signals
        }
      }, req);

    } catch (error) {
      console.error(
        "❌ Signal feed error:",
        error.stack || error.message
      );

      return sendJson(res, 500, {
        ok: false,
        error: error.message
      }, req);
    }
  }

  /*
   * UNKNOWN ROUTE
   */

  return sendJson(res, 404, {
    ok: false,
    error: "Route not found",
  });
}

const server =
  http.createServer(handleRequest);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log(
      "🧠 KitSetups API"
    );
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log(
      `🚀 Port: ${PORT}`
    );
    console.log(
      `❤️  Health: http://127.0.0.1:${PORT}/health`
    );
    console.log(
      `📊 BTC: http://127.0.0.1:${PORT}/api/analysis?symbol=BTCUSDT`
    );
    console.log(
      "💳 Subscription API: READY"
    );
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("");
  }
);
