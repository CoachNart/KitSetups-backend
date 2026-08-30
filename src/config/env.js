require("dotenv").config();

const required = ["FIREBASE_SERVICE_ACCOUNT_BASE64"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

module.exports = {
  port: Number(process.env.PORT || 8787),
  frontendUrl: process.env.FRONTEND_URL || "https://kitsetups.xyz",
};
