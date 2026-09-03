require("./env");

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function parseJsonServiceAccount(value, sourceName) {
  try {
    const serviceAccount = JSON.parse(value);
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("Firebase service-account JSON is missing required fields");
    }
    return {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: String(serviceAccount.private_key).replace(/\\n/g, "\n"),
    };
  } catch (error) {
    throw new Error(`Invalid ${sourceName}: ${error.message}`);
  }
}

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    let decoded;
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${error.message}`);
    }
    return parseJsonServiceAccount(decoded, "FIREBASE_SERVICE_ACCOUNT_BASE64");
  }

  // Keep compatibility with the original Render environment configuration.
  // This prevents a config-format migration from taking the entire API offline.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
  );
}

const serviceAccount = getServiceAccount();
const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

module.exports = { app, db };
