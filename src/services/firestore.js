const { getFirestore } = require("firebase-admin/firestore");
const { app } = require("../config/firebase");

const db = getFirestore(app);

const collections = {
  users: "users",
  signals: "signals",
  analysis: "analysis",
  apiKeys: "apiKeys",
};

function userRef(uid) {
  return db.collection(collections.users).doc(uid);
}

module.exports = {
  db,
  collections,
  userRef,
};
