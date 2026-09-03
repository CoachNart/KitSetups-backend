const { userRef } = require("../services/firestore");
const { getAuth } = require("firebase-admin/auth");
const { app } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");
const { addDays, TRIAL_DAYS, getAccessState } = require("../services/access");

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
  const trialEndsAt = claims.kitsetupsTrialEndsAt || (trialStartedAt ? addDays(trialStartedAt, TRIAL_DAYS)?.toISOString() : null);
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

async function syncMissingTrialWindow(uid, data) {
  if (data?.plan === "premium" || data?.trialStartedAt || data?.trialEndsAt) return data;

  try {
    const authUser = await getAuth(app).getUser(uid);
    const startedAt = data?.createdAt || authUser?.metadata?.creationTime || new Date().toISOString();
    const trialEndsAt = addDays(startedAt, TRIAL_DAYS)?.toISOString();
    if (!trialEndsAt) return data;

    const patch = {
      trialActive: new Date(trialEndsAt) > new Date(),
      trialStartedAt: startedAt,
      trialEndsAt,
      accessLocked: new Date(trialEndsAt) <= new Date(),
      updatedAt: new Date().toISOString(),
    };

    await userRef(uid).set(patch, { merge: true });

    try {
      await getAuth(app).setCustomUserClaims(uid, {
        ...(authUser.customClaims || {}),
        kitsetupsTrialStartedAt: startedAt,
        kitsetupsTrialEndsAt: trialEndsAt,
      });
    } catch (claimError) {
      console.warn("⚠️ Trial claim backfill unavailable:", claimError.message || claimError);
    }

    return { ...data, ...patch };
  } catch (error) {
    console.warn("⚠️ Trial window backfill unavailable:", error.message || error);
    return data;
  }
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

      let data = snap.data();
      data = await syncMissingTrialWindow(uid, data);
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
