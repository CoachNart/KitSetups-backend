require("./env");

const { initializeApp, cert, getApps } = require("firebase-admin/app");

const { getFirestore } = require("firebase-admin/firestore");

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!encoded) {
    throw new Error(
      "Missing environment variable: FIREBASE_SERVICE_ACCOUNT_BASE64",
    );
  }

  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");

    const serviceAccount = JSON.parse(json);

    if (
      !serviceAccount.project_id ||
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      throw new Error(
        "Firebase service-account JSON is missing required fields",
      );
    }

    return {
      projectId: serviceAccount.project_id,

      clientEmail: serviceAccount.client_email,

      privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
    };
  } catch (error) {
    throw new Error(
      `Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${error.message}`,
    );
  }
}

const serviceAccount = getServiceAccount();

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
      });

const db = getFirestore(app);

module.exports = {
  app,
  db,
};
