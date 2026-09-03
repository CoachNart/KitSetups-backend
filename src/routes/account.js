const { userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { getAccessState } = require("../services/access");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-KitSetups-Device",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function accountRoutes(req, res) {
  if (req.method !== "GET" || req.url !== "/api/account") {
    return false;
  }

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;

    try {
      const ref = userRef(uid);
      const snap = await ref.get();

      if (!snap.exists) {
        return json(res, 404, {
          ok: false,
          error: "Account not found",
          code: "ACCOUNT_NOT_FOUND",
        });
      }

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
    } catch (error) {
      console.error("ACCOUNT FIRESTORE ERROR:", error.stack || error.message || error);

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
