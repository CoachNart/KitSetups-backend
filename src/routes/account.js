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

async function authCreationFallback(uid, reqUser) {
  try {
    const authUser = await getAuth(app).getUser(uid);
    const created = authUser?.metadata?.creationTime;
    if (!created) return null;
    return { id: uid, email: authUser.email || reqUser?.email || "", displayName: authUser.displayName || reqUser?.name || "", photoURL: authUser.photoURL || reqUser?.picture || null, plan: "free", planName: "Free", trialStartedAt: created, createdAt: created, trialEndsAt: new Date(new Date(created).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() };
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
      const fallback = await authCreationFallback(uid, req.user);
      if (fallback) return json(res, 200, responseFor(uid, fallback, { accountSource: "firebase-auth-fallback", degraded: true }));
      const access = getAccessState(null);
      return json(res, 200, { ok: true, degraded: true, data: { id: uid, plan: "free", trialActive: false, accessLocked: true, accessStatus: "ACCOUNT_UNAVAILABLE", accessExpiresAt: null, access } });
    }
  });
}
module.exports = { accountRoutes };
