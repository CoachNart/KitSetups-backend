const fs = require("fs");
const path = require("path");
const marketEngine = require("./src/tools/marketEngine");
const market = require("./src/tools/market");
const whatsapp = require("./src/whatsapp");
const access = require("./src/core/access");

const INTERVAL = 60 * 1000;

// Global WhatsApp alert cooldown.
// Change this number later if needed.
const GLOBAL_ALERT_COOLDOWN_MINUTES = 30;
const GLOBAL_ALERT_COOLDOWN =
  GLOBAL_ALERT_COOLDOWN_MINUTES * 60 * 1000;

let lastGlobalAlertAt = 0;
const MAX_CONCURRENT = 5;

const alerted = new Map();

let activeWhatsAppSocket = null;
let activeWhatsAppJid = null;
let activeWhatsAppLid = null;

function setWhatsAppIdentity(jid, lid = null) {
  activeWhatsAppJid = jid || null;
  activeWhatsAppLid = lid || null;

  console.log(
    `👑 Scanner WhatsApp JID registered: ${
      activeWhatsAppJid || "NONE"
    }`
  );
}

function setWhatsAppSocket(sock) {
  activeWhatsAppSocket = sock;
}

async function getAllPairs() {
  return market.getAllPairs();
}

function setupKey(symbol, execution) {
  return [
    symbol,
    execution?.status,
    execution?.bos?.level,
    execution?.displacement?.candle?.openTime,
    execution?.sweep?.candle?.openTime
  ].join("|");
}

async function getWhatsAppSocket() {
  if (activeWhatsAppSocket) {
    return activeWhatsAppSocket;
  }

  for (let i = 0; i < 30; i++) {
    const sock = whatsapp.getSocket?.();

    if (sock) {
      activeWhatsAppSocket = sock;
      return sock;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return null;
}

function getOwnerIds() {
  const data = access.list?.() || {};

  return Array.isArray(data.owner?.ids)
    ? [...new Set(data.owner.ids.filter(Boolean))]
    : [];
}

function getSavedWhatsAppJid() {
  try {
    const file = path.join(
      __dirname,
      "data",
      "whatsapp-auth",
      "creds.json"
    );

    const creds = JSON.parse(
      fs.readFileSync(file, "utf8")
    );

    const jid = creds?.me?.id;

    if (jid) {
      console.log(`💾 Saved WhatsApp JID: ${jid}`);
      return jid;
    }
  } catch (err) {
    console.log(
      "⚠️ Could not read saved WhatsApp identity:",
      err.message
    );
  }

  return null;
}

async function sendWhatsAppAlert(symbol, plan) {
  console.log(`📤 Preparing WhatsApp alert for ${symbol}...`);

  const sock = await getWhatsAppSocket();

  if (!sock) {
    console.log(`❌ WhatsApp socket unavailable for ${symbol}`);
    return false;
  }

  let ownerJid =
    activeWhatsAppJid ||
    sock?.user?.id ||
    whatsapp.getOwnerJid?.() ||
    null;

  // Normalize our own device JID to the normal WhatsApp phone JID.
  // Example: 2348089453093:2@s.whatsapp.net
  //       -> 2348089453093@s.whatsapp.net
  if (
    ownerJid &&
    ownerJid.endsWith("@s.whatsapp.net")
  ) {
    ownerJid =
      ownerJid.replace(/:\d+@s\.whatsapp\.net$/, "@s.whatsapp.net");
  }

  console.log(
    "👑 WhatsApp owner phone JID:",
    ownerJid || "NONE"
  );

  if (!ownerJid) {
    console.log("❌ No real phone JID captured yet.");
    console.log(
      "📱 Send Nart Jnr one normal DM first, then alerts can use that chat."
    );
    return false;
  }

  const rr =
    plan.riskReward ??
    plan.trade?.rr ??
    "N/A";

  function formatPrice(value) {
    if (value == null || !Number.isFinite(Number(value))) {
      return "N/A";
    }

    const n = Number(value);

    if (Math.abs(n) >= 1) {
      return n.toFixed(2);
    }

    if (Math.abs(n) >= 0.1) {
      return n.toFixed(5);
    }

    if (Math.abs(n) >= 0.01) {
      return n.toFixed(6);
    }

    if (Math.abs(n) >= 0.001) {
      return n.toFixed(8);
    }

    return n.toFixed(10);
  }

  const entry = formatPrice(
    plan.entry ??
    plan.trade?.entry
  );

  const stop = formatPrice(
    plan.stop ??
    plan.trade?.stop
  );

  const target = formatPrice(
    plan.target ??
    plan.trade?.target
  );

  const message = [
    `🚨 *${symbol} — ${plan.direction || "N/A"}*`,
    "",
    `🟢 Entry: *${entry}*`,
    `🛑 Stop: *${stop}*`,
    `🎯 Target: *${target}*`,
    `⚖️ RR: *${rr}*`,
    "",
    "✅ Sweep",
    "✅ Displacement",
    "✅ BOS",
    "",
    "🔥 *ENTRY CONFIRMED*"
  ].join("\n");

  try {
    console.log(
      `📤 Sending ${symbol} alert to: ${ownerJid}`
    );

    await sock.sendMessage(ownerJid, {
      text: message
    });

    console.log(
      `✅ WHATSAPP ALERT SENT: ${symbol}`
    );

    return true;

  } catch (err) {
    console.log(
      `❌ Failed sending ${symbol} alert:`,
      err.stack || err.message
    );

    return false;
  }
}

async function analyze(symbol) {
  try {
    const result =
      await marketEngine.analyzeMarket(symbol);

    const execution =
      result?.tradePlan?.execution;

    if (!execution) return;

    const confirmed =
      execution.status === "ENTRY_CONFIRMED" ||
      result.tradePlan?.status === "ENTRY_CONFIRMED";

    if (!confirmed) return;

    const key = setupKey(symbol, execution);

    if (alerted.has(key)) return;

    alerted.set(key, Date.now());

    console.log("");
    console.log("🔥 *ENTRY CONFIRMED*");
    console.log(`🚨 ENTRY CONFIRMED: ${symbol}`);
    console.log(`📤 Preparing WhatsApp alert for ${symbol}...`);

    // GLOBAL ALERT COOLDOWN
    // Only one WhatsApp alert can be sent every 30 minutes.
    const now = Date.now();

    if (
      lastGlobalAlertAt &&
      now - lastGlobalAlertAt < GLOBAL_ALERT_COOLDOWN
    ) {
      const remaining = Math.ceil(
        (
          GLOBAL_ALERT_COOLDOWN -
          (now - lastGlobalAlertAt)
        ) / 60000
      );

      console.log(
        `⏳ Global alert cooldown: ${symbol} skipped. ` +
        `${remaining} min remaining.`
      );

      return;
    }

    lastGlobalAlertAt = now;

    await sendWhatsAppAlert(
      symbol,
      result.tradePlan
    );

  } catch (err) {
    console.log(
      `⚠️ ${symbol}: ${err.message}`
    );
  }
}

async function runScanner() {
  console.log("\n🔎 Scanning USDT perpetuals...");

  const pairs = await getAllPairs();

  console.log(`✅ ${pairs.length} pairs`);

  for (
    let i = 0;
    i < pairs.length;
    i += MAX_CONCURRENT
  ) {
    const batch =
      pairs.slice(i, i + MAX_CONCURRENT);

    await Promise.all(
      batch.map(symbol => analyze(symbol))
    );
  }

  console.log("✅ Scan complete.");
}

async function start() {
  console.log("🚀 Nart Jnr trade scanner starting...");

  const ownerIds = getOwnerIds();

  console.log(
    `👑 Owner IDs loaded: ${ownerIds.join(", ") || "NONE"}`
  );

  await getWhatsAppSocket();

  await runScanner();

  setInterval(async () => {
    try {
      await runScanner();
    } catch (err) {
      console.error(
        "❌ Scanner error:",
        err.message
      );
    }
  }, INTERVAL);
}

module.exports = {
  setWhatsAppSocket,
  setWhatsAppIdentity,
  start
};


start().catch(err => {
  console.error("❌ Fatal scanner error:", err.stack || err.message);
});
