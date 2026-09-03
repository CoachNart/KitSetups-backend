const { userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");

const ACCOUNT_CACHE_TTL_MS = 60 * 1000;
const accountCache = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function responseFor(uid, data) {
  const access = getAccessState(data);
  return {
    ok: true,
    data: {
      ...data,
      id: uid,
      trialActive: access.status === "TRIAL_ACTIVE",
      accessLocked: access.accessLocked,
      accessStatus: access.status,
      accessExpiresAt: access.expiresAt,
      access,
    },
  };
}

async function accountRoutes(req, res) {
  if (req.method !== "GET" || req.url !== "/api/account") return false;

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;
    const cached = accountCache.get(uid);

    // Firestore quota/rate-limit errors must not turn an already-known active
    // trial into a false locked/expired account. Access is recalculated from
    // the cached account timestamps on every request.
    if (cached && Date.now() - cached.cachedAt < ACCOUNT_CACHE_TTL_MS) {
      return json(res, 200, responseFor(uid, cached.account));
    }

    try {
      const snap = await userRef(uid).get();
      if (!snap.exists) {
        return json(res, 404, {
          ok: false,
          error: "Account not found",
          code: "ACCOUNT_NOT_FOUND",
        });
      }

      const data = snap.data();
      accountCache.set(uid, { account: data, cachedAt: Date.now() });
      return json(res, 200, responseFor(uid, data));
    } catch (error) {
      console.error("ACCOUNT FIRESTORE ERROR:", error.stack || error.message || error);

      if (cached) {
        return json(res, 200, {
          ...responseFor(uid, cached.account),
          degraded: true,
          data: {
            ...responseFor(uid, cached.account).data,
            accountSource: "memory-cache",
          },
        });
      }

      const access = getAccessState(null);
      return json(res, 200, {
        ok: true,
        degraded: true,
        data: {
          id: uid,
          plan: "free",
          trialActive: false,
          accessLocked: true,
          accessStatus: "ACCOUNT_UNAVAILABLE",
          accessExpiresAt: null,
          access,
        },
      });
    }
  });
}

module.exports = { accountRoutes };
