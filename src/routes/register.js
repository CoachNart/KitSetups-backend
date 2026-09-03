const { db, userRef } = require("../services/firestore");
const {
  deviceRef,
  fingerprintRef,
  getClientIp,
  hashIp,
} = require("../services/device");
const { requireAuth } = require("../middleware/auth");
const { addDays, TRIAL_DAYS, getAccessState } = require("../services/access");

const registrationAttempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function rateLimited(req) {
  const key = hashIp(getClientIp(req));
  const now = Date.now();
  const current = registrationAttempts.get(key) || [];
  const recent = current.filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  registrationAttempts.set(key, recent);
  return recent.length > MAX_ATTEMPTS;
}

async function registerRoutes(req, res) {
  if (req.method !== "POST" || req.url !== "/api/auth/register") return false;

  return requireAuth(req, res, async () => {
    if (rateLimited(req)) {
      return json(res, 429, {
        ok: false,
        error: "Too many registration attempts. Please try again later.",
        code: "REGISTRATION_RATE_LIMITED",
      });
    }

    const uid = req.user.uid;
    const deviceId = req.headers["x-kitsetups-device"];
    const fingerprint = req.headers["x-kitsetups-fingerprint"];

    if (!deviceId || typeof deviceId !== "string") {
      return json(res, 400, {
        ok: false,
        error: "Device verification is required.",
        code: "DEVICE_ID_REQUIRED",
      });
    }

    if (deviceId.length < 32 || deviceId.length > 128) {
      return json(res, 400, {
        ok: false,
        error: "Invalid device verification token.",
        code: "INVALID_DEVICE_ID",
      });
    }

    if (!fingerprint || typeof fingerprint !== "string" || fingerprint.length < 32) {
      return json(res, 400, {
        ok: false,
        error: "Device verification could not be completed.",
        code: "FINGERPRINT_REQUIRED",
      });
    }

    const user = userRef(uid);
    const device = deviceRef(deviceId);
    const fingerprintRecord = fingerprintRef({
      platform: fingerprint,
    });

    try {
      let account;
      const clientIpHash = hashIp(getClientIp(req));
      const userAgent = String(req.headers["user-agent"] || "").slice(0, 300);

      await db.runTransaction(async (tx) => {
        const reads = [tx.get(user), tx.get(device)];
        if (fingerprintRecord) reads.push(tx.get(fingerprintRecord));
        const [userSnap, deviceSnap, fingerprintSnap] = await Promise.all(reads);

        if (userSnap.exists) throw new Error("ACCOUNT_EXISTS");

        if (deviceSnap.exists) throw new Error("DEVICE_ALREADY_REGISTERED");

        if (fingerprintSnap?.exists && fingerprintSnap.data()?.uid) {
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
          security: {
            deviceBound: true,
            fingerprintBound: Boolean(fingerprintRecord),
            registrationIpHash: clientIpHash,
            userAgent,
          },
        };

        tx.set(user, account);
        tx.set(device, { uid, createdAt, updatedAt: createdAt });
        if (fingerprintRecord) {
          tx.set(fingerprintRecord, {
            uid,
            createdAt,
            updatedAt: createdAt,
          });
        }
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
          error: "A KitSetups account is already registered for this login.",
          code: "ACCOUNT_EXISTS",
        });
      }

      if (error.message === "DEVICE_ALREADY_REGISTERED") {
        return json(res, 409, {
          ok: false,
          error: "This device is already associated with a registered KitSetups account. This account will not receive KitSetups data access.",
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
