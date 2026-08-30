require("./config/env");

const http = require("http");
const { authRoutes } = require("./routes/auth");
const { accountRoutes } = require("./routes/account");
const { registerRoutes } = require("./routes/register");
const { signalsRoutes } = require("./routes/signals");
const { analysisRoutes } = require("./routes/analysis");
const { developerRoutes } = require("./routes/developer");

const PORT = Number(process.env.PORT || 8787);

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });

  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "kitsetups-backend",
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
    }

    const handled = await authRoutes(req, res);

    if (handled !== false) return handled;

    const accountHandled = await accountRoutes(req, res);

    if (accountHandled !== false) return accountHandled;

    const signalsHandled = await signalsRoutes(req, res);

    if (signalsHandled !== false) return signalsHandled;

    const analysisHandled = await analysisRoutes(req, res);

    if (analysisHandled !== false) return analysisHandled;

    const developerHandled = await developerRoutes(req, res);

    if (developerHandled !== false) return developerHandled;

    const registerHandled = await registerRoutes(req, res);

    if (registerHandled !== false) return registerHandled;

    return sendJson(res, 404, {
      ok: false,
      error: "Route not found",
      code: "NOT_FOUND",
    });
  } catch (error) {
    console.error("SERVER ERROR:", error);

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 KitSetups backend running on :${PORT}`);
});
