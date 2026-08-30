const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getPrivateKey() {
  return (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: getPrivateKey(),
        }),
      });

const db = getFirestore(app);

module.exports = { app, db };
