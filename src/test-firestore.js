require("./config/env");

const { db } = require("./config/firebase");

(async () => {
  try {
    const ref = db.collection("_kitsetups_test").doc("connection");

    await ref.set({
      ok: true,
      testedAt: new Date().toISOString(),
    });

    const snap = await ref.get();

    console.log("✅ FIRESTORE WRITE:", snap.exists);
    console.log("✅ FIRESTORE DATA:", snap.data());

    await ref.delete();

    console.log("✅ FIRESTORE DELETE: true");
    console.log("🔥 FIRESTORE CONNECTION WORKS");
  } catch (error) {
    console.error("❌ FIRESTORE FAILED");
    console.error(error.message);
    process.exit(1);
  }
})();
