require("dotenv").config();

const hasBase64 = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
const hasLegacy = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY,
);

if (!hasBase64 && !hasLegacy) {
  throw new Error(
    "Missing Firebase configuration. Set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
  );
}

module.exports = {
  port: Number(process.env.PORT || 8787),
  frontendUrl: process.env.FRONTEND_URL || "https://kitsetups.xyz",
};
