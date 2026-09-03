const crypto = require("crypto");
const { db, collections } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key, X-KitSetups-Device",
    "Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS",
  });

  res.end(JSON.stringify(data));
}

function generateApiKey() {
  return `ks_live_${crypto.randomBytes(32).toString("hex")}`;
}

function inactiveKeyData() {
  return {
    active: false,
    keyId: null,
    prefix: null,
    createdAt: null,
    lastUsedAt: null,
    usage: { requests: 0 },
  };
}

async function developerRoutes(req, res) {
  if (!req.url.startsWith("/api/developer/key")) return false;

  if (req.method === "OPTIONS") return json(res, 204, null);

  return requireAuth(req, res, async () => {
    const uid = req.user.uid;
    const ref = db.collection(collections.apiKeys).doc(uid);

    try {
      if (req.method === "GET") {
        const snap = await ref.get();

        if (!snap.exists || snap.data().revokedAt) {
          return json(res, 200, { ok: true, data: inactiveKeyData() });
        }

        const data = snap.data();
        return json(res, 200, {
          ok: true,
          data: {
            active: true,
            keyId: data.keyId || uid,
            prefix: data.prefix || null,
            createdAt: data.createdAt || null,
            lastUsedAt: data.lastUsedAt || null,
            usage: data.usage || { requests: 0 },
          },
        });
      }

      if (req.method === "POST") {
        const existing = await ref.get();

        if (existing.exists && !existing.data().revokedAt) {
          return json(res, 409, {
            ok: false,
            error: "An active API key already exists",
            code: "API_KEY_EXISTS",
          });
        }

        const key = generateApiKey();
        const now = new Date().toISOString();
        const prefix = key.slice(0, 15);

        await ref.set({
          keyId: uid,
          uid,
          keyHash: crypto.createHash("sha256").update(key).digest("hex"),
          prefix,
          createdAt: now,
          lastUsedAt: null,
          revokedAt: null,
          usage: { requests: 0 },
        });

        return json(res, 201, {
          ok: true,
          key,
          data: {
            active: true,
            keyId: uid,
            prefix,
            createdAt: now,
            lastUsedAt: null,
            usage: { requests: 0 },
          },
        });
      }

      if (req.method === "DELETE") {
        const existing = await ref.get();

        if (!existing.exists || existing.data().revokedAt) {
          return json(res, 404, {
            ok: false,
            error: "No active API key found",
            code: "API_KEY_NOT_FOUND",
          });
        }

        const now = new Date().toISOString();
        await ref.update({ revokedAt: now });

        return json(res, 200, {
          ok: true,
          data: {
            active: false,
            keyId: existing.data().keyId || uid,
            prefix: existing.data().prefix || null,
            createdAt: existing.data().createdAt || null,
            lastUsedAt: existing.data().lastUsedAt || null,
            usage: existing.data().usage || { requests: 0 },
          },
        });
      }

      return json(res, 405, {
        ok: false,
        error: "Method not allowed",
        code: "METHOD_NOT_ALLOWED",
      });
    } catch (error) {
      console.error("DEVELOPER KEY FIRESTORE ERROR:", error.stack || error.message || error);

      if (req.method === "GET") {
        return json(res, 200, {
          ok: true,
          degraded: true,
          data: inactiveKeyData(),
        });
      }

      return json(res, 503, {
        ok: false,
        error: "Developer key storage temporarily unavailable",
        code: "DEVELOPER_KEY_STORAGE_UNAVAILABLE",
      });
    }
  });
}

module.exports = { developerRoutes };
