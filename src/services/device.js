const crypto = require("crypto");
const { db } = require("./firestore");

const DEVICES = "devices";

function hashDeviceId(deviceId) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId))
    .digest("hex");
}

function deviceRef(deviceId) {
  return db.collection(DEVICES).doc(hashDeviceId(deviceId));
}

module.exports = {
  hashDeviceId,
  deviceRef,
};
