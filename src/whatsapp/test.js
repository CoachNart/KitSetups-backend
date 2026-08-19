const {
  default: makeWASocket,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");

async function start() {
  const { state, saveCreds } =
    await useMultiFileAuthState("data/whatsapp-auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection }) => {
    if (connection === "open") {
      console.log("\n🔥 CONNECTED\n");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;

      console.log("\n📩 MESSAGE RECEIVED");
      console.log("JID:", jid);
      console.log("Message:", JSON.stringify(msg.message));

      try {
        await sock.sendMessage(
          jid,
          { text: "Nart Jnr received this. 🫡" },
          { quoted: msg }
        );

        console.log("📤 REPLY SENT");
      } catch (error) {
        console.error("❌ SEND FAILED:", error);
      }
    }
  });
}

start().catch(console.error);
