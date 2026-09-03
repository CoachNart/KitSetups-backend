const { db, userRef } = require("../services/firestore");
const { deviceRef } = require("../services/device");
const { requireAuth } = require("../middleware/auth");
const { addDays, TRIAL_DAYS, getAccessState } = require("../services/access");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

async function registerRoutes(req, res) {
  if (req.method !== "POST" || req.url !== "/api/auth/register") {
    return false;
  }

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;
    const deviceId = req.headers["x-kitsetups-device"];

    if (!deviceId || typeof deviceId !== "string") {
      return json(res, 400, {
        ok: false,
        error: "Device identifier required",
        code: "DEVICE_ID_REQUIRED",
      });
    }

    if (deviceId.length < 16 || deviceId.length > 256) {
      return json(res, 400, {
        ok: false,
        error: "Invalid device identifier",
        code: "INVALID_DEVICE_ID",
      });
    }

    const user = userRef(uid);
    const device = deviceRef(deviceId);

    try {
      let account;

      await db.runTransaction(async (tx) => {
        const [userSnap, deviceSnap] = await Promise.all([
          tx.get(user),
          tx.get(device),
        ]);

        if (userSnap.exists) {
          throw new Error("ACCOUNT_EXISTS");
        }

        if (deviceSnap.exists) {
          throw new Error("DEVICE_ALREADY_REGISTERED");
        }

        const now = new Date();
        const createdAt = now.toISOString();
        const trialEndsAt = addDays(now, TRIAL_DAYS).toISOString();

        account = {
          id: uid,
          email: req.user.email || "",
          displayName: req.user.name || "",
          photoURL: req.user.picture || null,
          plan: "free",
          planName: "Free",
          trialActive: true,
          trialStartedAt: now,
          createdAt,
          updatedAt: createdAt,
          trialEndsAt,
          accessLocked: false,
        };

        tx.set(user, account);
        tx.set(device, {
          uid,
          createdAt,
          updatedAt: createdAt,
        });
      });

      const access = getAccessState(account);

      return json(res, 201, {
        ok: true,
        data: {
          id: uid,
          email: account.email,
          displayName: account.displayName,
          photoURL: account.photoURL,
          plan: account.plan,
          planName: account.planName,
          trialActive: access.status === "TRIAL_ACTIVE",
          trialStartedAt: account.trialStartedAt.toISOString(),
          trialEndsAt: account.trialEndsAt,
          accessLocked: access.accessLocked,
          accessStatus: access.status,
          accessExpiresAt: access.expiresAt,
          access,
        },
      });
    } catch (error) {
      if (error.message === "ACCOUNT_EXISTS") {
        return json(res, 409, {
          ok: false,
          error: "Account already exists",
          code: "ACCOUNT_EXISTS",
        });
      }

      if (error.message === "DEVICE_ALREADY_REGISTERED") {
        return json(res, 409, {
          ok: false,
          error: "This device already has a KitSetups account",
          code: "DEVICE_ALREADY_REGISTERED",
        });
      }

      console.error("❌ Registration failed:", error.stack || error);
      return json(res, 500, {
        ok: false,
        error: "Unable to create KitSetups account",
        code: "REGISTRATION_FAILED",
      });
    }
  });
}

module.exports = { registerRoutes };
