const { db } = require("../services/firestore");
const { userRef } = require("../services/firestore");
const { deviceRef } = require("../services/device");
const { requireAuth } = require("../middleware/auth");
const { addDays, TRIAL_DAYS } = require("../services/access");

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

    const user = userRef(uid);
    const device = deviceRef(deviceId);

    if (deviceId.length < 16 || deviceId.length > 256) {
      return json(res, 400, {
        ok: false,
        error: "Invalid device identifier",
        code: "INVALID_DEVICE_ID",
      });
    }

    const [userSnap, deviceSnap] = await Promise.all([
      user.get(),
      device.get(),
    ]);

    // Existing Firebase identity already belongs to an account.
    if (userSnap.exists) {
      return json(res, 409, {
        ok: false,
        error: "Account already exists",
        code: "ACCOUNT_EXISTS",
      });
    }

    // This device has already registered another KitSetups account.
    if (deviceSnap.exists) {
      return json(res, 409, {
        ok: false,
        error: "This device already has a KitSetups account",
        code: "DEVICE_ALREADY_REGISTERED",
      });
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const trialEndsAt = addDays(now, TRIAL_DAYS).toISOString();

    const account = {
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

    await db.runTransaction(async (tx) => {
      tx.set(user, account);
      tx.set(device, {
        uid,
        createdAt: createdAt,
        updatedAt: createdAt,
      });
    });

    return json(res, 201, {
      ok: true,
      data: account,
    });
  });
}

module.exports = { registerRoutes };
