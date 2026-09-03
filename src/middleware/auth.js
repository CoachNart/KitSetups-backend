const { getAuth } = require("firebase-admin/auth");
const { app } = require("../config/firebase");

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

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      json(res, 401, {
        ok: false,
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
      return true;
    }

    const token = header.slice(7).trim();

    if (!token) {
      json(res, 401, {
        ok: false,
        error: "Authentication token missing",
        code: "AUTH_REQUIRED",
      });
      return true;
    }

    req.user = await firebaseAuth.verifyIdToken(token);

    return next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);

    json(res, 401, {
      ok: false,
      error: "Invalid or expired authentication token",
      code: "AUTH_INVALID",
    });

    return true;
  }
}

module.exports = { requireAuth };
