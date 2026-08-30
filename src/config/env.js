require("dotenv").config();

const required = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

module.exports = {
  port: Number(process.env.PORT || 8787),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};
