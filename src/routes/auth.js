const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { app } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");
const { addDays, TRIAL_DAYS, getAccessState } = require("../services/access");

const db = getFirestore(app);
const firebaseAuth = getAuth(app);

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function authFallback(uid, authUser) {
  const claims = authUser?.customClaims || {};
  const created = authUser?.metadata?.creationTime || null;
  const trialStartedAt = claims.kitsetupsTrialStartedAt || created;
  const trialEndsAt = claims.kitsetupsTrialEndsAt || (trialStartedAt ? addDays(trialStartedAt, TRIAL_DAYS)?.toISOString() : null);
  const account = {
    id: uid,
    email: authUser?.email || "",
    displayName: authUser?.displayName || "",
    photoURL: authUser?.photoURL || null,
    plan: "free",
    planName: "Free",
    trialStartedAt,
    createdAt: created || trialStartedAt,
    trialEndsAt,
  };
  const access = getAccessState(account);
  return {
    ...account,
    trialActive: access.status === "TRIAL_ACTIVE",
    accessLocked: access.accessLocked,
    accessStatus: access.status,
    accessExpiresAt: access.expiresAt,
    access,
  };
}

async function authRoutes(req, res) {
  if (req.method !== "GET" || req.url !== "/api/auth/me") return false;

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;
    try {
      const snap = await db.collection("users").doc(uid).get();
      if (snap.exists) {
        const data = snap.data();
        const access = getAccessState(data);
        return json(res, 200, {
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
        });
      }

      return json(res, 404, {
        ok: false,
        error: "Account not found",
        code: "ACCOUNT_NOT_FOUND",
      });
    } catch (error) {
      console.warn("⚠️ Auth account read unavailable; using Firebase Auth fallback:", error.message || error);
      try {
        const authUser = await firebaseAuth.getUser(uid);
        return json(res, 200, {
          ok: true,
          degraded: true,
          data: authFallback(uid, authUser),
        });
      } catch (fallbackError) {
        console.error("AUTH FALLBACK ERROR:", fallbackError.message || fallbackError);
        return json(res, 503, {
          ok: false,
          error: "Authentication service temporarily unavailable",
          code: "AUTH_SERVICE_UNAVAILABLE",
        });
      }
    }
  });
}

module.exports = { authRoutes };
