require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const crypto = require("crypto");
const webpush = require("web-push");
const marketEngine = require("./src/tools/marketEngine");
const market = require("./src/tools/market");
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

if (getApps().length === 0) {
  // Support multiple ways to provide the Firebase service account:
  // 1) FIREBASE_SERVICE_ACCOUNT_BASE64 (base64-encoded JSON) [preferred]
  // 2) FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON string)
  // 3) GOOGLE_APPLICATION_CREDENTIALS (path to ADC file) - falls back to ADC if present
  const encodedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const rawServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const gaCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!encodedServiceAccount && !rawServiceAccountJson && !gaCredentials) {
    throw new Error(
      "FIREBASE service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS"
    );
  }

  let initialized = false;

  if (encodedServiceAccount) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(encodedServiceAccount, "base64").toString("utf8")
      );

      initializeApp({
        credential: cert(serviceAccount),
      });

      initialized = true;
    } catch (err) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", err);
      throw err;
    }
  }

  if (!initialized && rawServiceAccountJson) {
    try {
      const serviceAccount = JSON.parse(rawServiceAccountJson);

      initializeApp({
        credential: cert(serviceAccount),
      });

      initialized = true;
    } catch (err) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", err);
      throw err;
    }
  }

  if (!initialized && gaCredentials) {
    // Let firebase-admin pick up Application Default Credentials from the environment
    // (GOOGLE_APPLICATION_CREDENTIALS points to a JSON file).
    initializeApp();
    initialized = true;
  }
}

const firebaseAuth = getAuth();
const db = getFirestore();


const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log("🔔 Web Push: READY");
} else {
  console.warn("⚠️ Web Push: VAPID environment variables missing");
}

const SIGNALS_COLLECTION = "signals";
const SIGNALS_DOCUMENT = "latest";

async function saveSignalsToFirestore(signals) {
  await db
    .collection(SIGNALS_COLLECTION)
    .doc(SIGNALS_DOCUMENT)
    .set({
      signals,
      updatedAt: new Date().toISOString(),
    });

  console.log(
    `📡 Saved ${signals.length} signals to Firestore`
  );
}


async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("⚠️ Web Push not configured. Skipping notification.");
    return;
  }

  const store = readSubscriptions();
  // Use the dedicated subscriptions map instead of overloading `users`.
  const subscriptions = store.subscriptions?.[userId] || [];

  for (const subscription of [...subscriptions]) {
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error(
        "❌ Push delivery failed:",
        error.statusCode || error.message
      );

      if (error.statusCode === 404 || error.statusCode === 410) {
        // Remove the dead subscription from the dedicated subscriptions map.
        store.subscriptions[userId] = (store.subscriptions[userId] || []).filter(
          (item) => item.endpoint !== subscription.endpoint
        );
      }
    }
  }

  writeSubscriptions(store);
}

async function sendPushToAllUsers(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("⚠️ Web Push not configured. Skipping notification.");
    return;
  }

  const store = readSubscriptions();

  for (const userId of Object.keys(store.users)) {
    try {
      await sendPushToUser(userId, payload);
    } catch (err) {
      console.error("Failed sending push to user", userId, err);
    }
  }
}

// rest of file unchanged (omitted for brevity)
