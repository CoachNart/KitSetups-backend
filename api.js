require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const crypto = require("crypto");
const webpush = require("web-push");
const marketEngine = require("./src/tools/marketEngine");
const market = require("./src/tools/market");
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  const encodedServiceAccount =
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!encodedServiceAccount) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured"
    );
  }

  const serviceAccount = JSON.parse(
    Buffer.from(
      encodedServiceAccount,
      "base64"
    ).toString("utf8")
  );

  initializeApp({
    credential: cert(serviceAccount),
  });
}

const firebaseAuth = getAuth();
const db = getFirestore();


const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log("🔔 Web Push: READY");
} else {
  console.warn("⚠️ Web Push: VAPID environment variables missing");
}

const SIGNALS_COLLECTION = "signals";
const SIGNALS_DOCUMENT = "latest";

async function saveSignalsToFirestore(signals) {
  await db
    .collection(SIGNALS_COLLECTION)
    .doc(SIGNALS_DOCUMENT)
    .set({
      signals,
      updatedAt: new Date().toISOString(),
    });

  console.log(
    `📡 Saved ${signals.length} signals to Firestore`
  );
}


async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("⚠️ Web Push not configured. Skipping notification.");
    return;
  }

  const store = readSubscriptions();
  const subscriptions = store.users[userId] || [];

  for (const subscription of [...subscriptions]) {
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error(
        "❌ Push delivery failed:",
        error.statusCode || error.message
      );

      if (error.statusCode === 404 || error.statusCode === 410) {
        store.users[userId] = store.users[userId].filter(
          (item) => item.endpoint !== subscription.endpoint
        );
      }
    }
  }

  writeSubscriptions(store);
}

async function sendPushToAllUsers(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("⚠️ Web Push not configured. Skipping notification.");
    return;
  }

  const store = readSubscriptions();

  for (const userId of Object.keys(store.users)) {
    await sendPushToUser(userId, payload);
  }
}

async function publishApprovedSignal(signal) {
  if (signal?.tradePlan?.status !== "SETUP") {
    return;
  }

  const symbol = signal.symbol;

  if (!symbol) {
    console.error(
      "❌ Approved signal has no symbol. Skipping Firestore."
    );
    return;
  }

  const ref = db
    .collection(SIGNALS_COLLECTION)
    .doc(symbol);

  await ref.set({
    ...signal,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  console.log(
    `💾 Published approved signal: ${symbol} ${signal.tradePlan.direction} | RR ${signal.tradePlan.riskReward ?? "N/A"}`
  );

  await sendPushToAllUsers({
    title: `KitSetups · ${symbol}`,
    body: `${signal.tradePlan.direction} setup confirmed · RR ${signal.tradePlan.riskReward ?? "N/A"}`,
    url: "/?tab=setups",
  });

  console.log(`🔔 Push notification sent for ${symbol}`);
}

async function runSignalScanner() {
  console.log("🔎 Discovering Bybit USDT perpetual pairs...");

  const symbols = await market.getAllPairs();

  console.log(
    `📊 Bybit returned ${symbols.length} active USDT perpetual pairs`
  );

  // Keep Bybit requests below its rate limit.
  // The market engine makes multiple API calls per symbol.
  const concurrency = 1;
  let approvedCount = 0;

  async function scanSymbol(symbol) {
    try {
      const result =
        await marketEngine.analyzeMarket(symbol);

      const plan = result?.tradePlan;

      // Only fully approved setups are published.
      if (plan?.status !== "SETUP") {
        return;
      }

      approvedCount++;

      console.log(
        `🎯 APPROVED SETUP: ${symbol} ${plan.direction} | RR ${plan.riskReward ?? "N/A"}`
      );

      // Publish immediately. Do not wait for the entire scan.
      await publishApprovedSignal(result);

    } catch (error) {
      console.error(
        `❌ Scanner failed for ${symbol}:`,
        error.message
      );
    }
  }

  const totalBatches = Math.ceil(
    symbols.length / concurrency
  );

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const batchNumber =
      Math.floor(i / concurrency) + 1;

    console.log(
      `📡 Scanner batch ${batchNumber}/${totalBatches}`
    );

    await Promise.all(
      batch.map(scanSymbol)
    );

    // Small pause between batches to avoid Bybit API 10006.
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  console.log(
    `🏁 Scanner finished: ${approvedCount} approved signals / ${symbols.length} pairs`
  );
}

let scannerRunning = false;

function startSignalScanner() {
  console.log(
    "🚀 Starting Firestore Bybit signal scanner..."
  );

  async function run() {
    if (scannerRunning) {
      console.log(
        "⏳ Previous scanner cycle is still running. Skipping this cycle."
      );
      return;
    }

    scannerRunning = true;

    try {
      await runSignalScanner();
    } catch (error) {
      console.error(
        "❌ Scanner cycle failed:",
        error.stack || error.message
      );
    } finally {
      scannerRunning = false;
    }
  }

  run();

  setInterval(
    run,
    5 * 60 * 1000
  );
}

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);

const BNB_RPC =
  process.env.BNB_RPC_URL ||
  "https://bsc-dataseed.binance.org";

const PAYMENT_ADDRESS =
  process.env.NART_PAYMENT_ADDRESS ||
  "0x1c35bf9d920e1b5d7e7e37ce1d15a1b9500f8474";

const PREMIUM_PRICE_USDT =
  Number(process.env.NART_PREMIUM_PRICE_USDT || 30);

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

async function getFirebaseUserId(req) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return null;
    }

    const idToken = authHeader.slice(7).trim();

    if (!idToken) {
      return null;
    }

    const decodedToken = await firebaseAuth.verifyIdToken(idToken);

    return decodedToken.uid || null;
  } catch (error) {
    console.error(
      "❌ Firebase token verification failed:",
      error.message
    );

    return null;
  }
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



const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(req, key, max = RATE_LIMIT_MAX) {
  const now = Date.now();
  const clientKey = `${key}:${getClientIp(req)}`;

  const existing = rateLimitStore.get(clientKey);

  if (!existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientKey, {
      startedAt: now,
      count: 1,
    });
    return false;
  }

  existing.count++;

  return existing.count > max;
}

function rejectRateLimit(res, req) {
  return sendJson(res, 429, {
    ok: false,
    error: "Too many requests. Please try again shortly.",
  }, req);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let rejected = false;

    req.on("data", chunk => {
      if (rejected) return;

      data += chunk;

      if (data.length > 100000) {
        rejected = true;
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (rejected) return;

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

// Compatibility alias used by some handlers.
function readJsonBody(req) {
  return readBody(req);
}

const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

const PLANS = {
  free: {
    name: "FREE",
  },

  premium: {
    name: "PREMIUM",
  },
};

function getCorsOrigin(req) {
  const origin = req?.headers?.origin || "";

  const allowedOrigins = [
    "https://kitsetups.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  // Strict allowlist: return the origin only if it is explicitly allowed.
  // If not allowed, return null so callers can omit CORS headers.
  return allowedOrigins.includes(origin) ? origin : null;
}

function sendJson(res, status, data, req = null) {
  const body = JSON.stringify(data);

  const allowedOrigin =
    getCorsOrigin(req);

  // Build headers and only expose CORS when the origin is allowed.
  const headers = {
    "Content-Type": "application/json",
    "Vary": "Origin",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Nart-User, Cookie";
  }

  res.writeHead(status, headers);
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
    const now = new Date().toISOString();

    store.users[userId] = {
      id: userId,
      plan: "free",
      createdAt: now,
      trialStartedAt: now,
    };

    writeSubscriptions(store);
  }

  const user = store.users[userId];

  // Migration for existing users.
  if (!user.createdAt) {
    user.createdAt = new Date().toISOString();
  }

  if (!user.trialStartedAt) {
    user.trialStartedAt = user.createdAt;
  }

  // Automatically expire Premium access.
  if (
    user.plan === "premium" &&
    user.premiumExpiresAt &&
    new Date(user.premiumExpiresAt).getTime() <= Date.now()
  ) {
    user.plan = "free";

    delete user.paymentTx;
    delete user.paymentAmount;
    delete user.paymentNetwork;
    delete user.paymentToken;
    delete user.premiumStartedAt;
    delete user.premiumExpiresAt;
  }

  writeSubscriptions(store);

  return user;
}

function getTrialInfo(user) {
  const startedAt = new Date(
    user.trialStartedAt || user.createdAt
  ).getTime();

  const endsAt = startedAt + TRIAL_DURATION_MS;
  const now = Date.now();

  return {
    active: now < endsAt,
    startedAt: new Date(startedAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    remainingMs: Math.max(endsAt - now, 0),
  };
}

function hasActiveAccess(user) {
  if (user.plan === "premium") {
    return true;
  }

  return getTrialInfo(user).active;
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
    if (isRateLimited(req, "signup", 10)) {
      return rejectRateLimit(res, req);
    }

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
    if (isRateLimited(req, "login", 10)) {
      return rejectRateLimit(res, req);
    }

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

    const auth =
      readAuthStore();

    if (token && auth.sessions[token]) {
      delete auth.sessions[token];
      writeAuthStore(auth);
    }

    clearSessionCookie(res);

    return sendJson(res, 200, {
      ok: true,
    });
  }

  if (req.method === "OPTIONS") {
    // If the origin is not allowed, respond with 403 on preflight to be explicit.
    const allowedOrigin = getCorsOrigin(req);

    if (!allowedOrigin) {
      return sendJson(res, 403, {
        ok: false,
        error: "CORS origin not allowed",
      }, req);
    }

    res.writeHead(204, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nart-User, Cookie",
      "Vary": "Origin",
    });

    return res.end();
  }

  /* truncated for brevity in tool input */
