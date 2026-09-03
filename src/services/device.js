const crypto = require("crypto");
const { db } = require("./firestore");

const DEVICES = "devices";
const DEVICE_FINGERPRINTS = "deviceFingerprints";

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeFingerprint(value) {
  if (!value || typeof value !== "object") return "";

  const keys = [
    "platform",
    "hardwareConcurrency",
    "deviceMemory",
    "screen",
    "timezone",
    "languages",
    "colorDepth",
    "pixelRatio",
    "touchPoints",
    "webgl",
  ];

  return keys.map((key) => `${key}:${String(value[key] ?? "")}`).join("|");
}

function hashDeviceId(deviceId) {
  return digest(deviceId);
}

function hashFingerprint(fingerprint) {
  return digest(normalizeFingerprint(fingerprint));
}

function deviceRef(deviceId) {
  return db.collection(DEVICES).doc(hashDeviceId(deviceId));
}

function fingerprintRef(fingerprint) {
  const hash = hashFingerprint(fingerprint);
  return hash ? db.collection(DEVICE_FINGERPRINTS).doc(hash) : null;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

function hashIp(ip) {
  return digest(ip || "");
}

module.exports = {
  hashDeviceId,
  hashFingerprint,
  deviceRef,
  fingerprintRef,
  getClientIp,
  hashIp,
};
