const { userRef } = require("../services/firestore");
const { getAuth } = require("firebase-admin/auth");
const { app } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");

const ACCOUNT_CACHE_TTL_MS = 60 * 1000;
const accountCache = new Map();

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" });
  res.end(JSON.stringify(data));
}

function responseFor(uid, data, extra = {}) {
  const access = getAccessState(data);
  return { ok: true, data: { ...data, id: uid, trialActive: access.status === "TRIAL_ACTIVE", accessLocked: access.accessLocked, accessStatus: access.status, accessExpiresAt: access.expiresAt, access, ...extra } };
}

function claimFallback(uid, authUser) {
  const claims = authUser?.customClaims || {};
  const created = authUser?.metadata?.creationTime || null;
  const trialStartedAt = claims.kitsetupsTrialStartedAt || created;
  const trialEndsAt = claims.kitsetupsTrialEndsAt || (trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() : null);
  const premiumEndsAt = claims.kitsetupsSubscriptionEndsAt || null;
  return {
    id: uid,
    email: authUser?.email || "",
    displayName: authUser?.displayName || "",
    photoURL: authUser?.photoURL || null,
    plan: claims.kitsetupsPlan === "premium" ? "premium" : "free",
    planName: claims.kitsetupsPlan === "premium" ? "Premium" : "Free",
    trialStartedAt,
    createdAt: created || trialStartedAt,
    trialEndsAt,
    subscriptionEndsAt: premiumEndsAt,
  };
}

async function authCreationFallback(uid) {
  try {
    const authUser = await getAuth(app).getUser(uid);
    if (!authUser) return null;
    return claimFallback(uid, authUser);
  } catch (error) {
    console.warn("⚠️ Firebase Auth account fallback unavailable:", error.message || error);
    return null;
  }
}

async function accountRoutes(req, res) {
  if (req.method !== "GET" || req.url !== "/api/account") return false;
  return requireAuth(req, res, async () => {
    const uid = req.user.uid;
    const cached = accountCache.get(uid);
    if (cached && Date.now() - cached.cachedAt < ACCOUNT_CACHE_TTL_MS) return json(res, 200, responseFor(uid, cached.account));
    try {
      const snap = await userRef(uid).get();
      if (!snap.exists) return json(res, 404, { ok: false, error: "Account not found", code: "ACCOUNT_NOT_FOUND" });
      const data = snap.data();
      accountCache.set(uid, { account: data, cachedAt: Date.now() });
      return json(res, 200, responseFor(uid, data));
    } catch (error) {
      console.error("ACCOUNT FIRESTORE ERROR:", error.stack || error.message || error);
      if (cached) return json(res, 200, responseFor(uid, cached.account, { accountSource: "memory-cache", degraded: true }));
      const fallback = await authCreationFallback(uid);
      if (fallback) return json(res, 200, responseFor(uid, fallback, { accountSource: "firebase-auth-fallback", degraded: true }));
      return json(res, 503, { ok: false, error: "Account service temporarily unavailable", code: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });
}
module.exports = { accountRoutes };
