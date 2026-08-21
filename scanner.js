const fs = require("fs");
const path = require("path");
const marketEngine = require("./src/tools/marketEngine");
const market = require("./src/tools/market");

const SIGNALS_FILE = path.join(
  __dirname,
  "data",
  "signals.json"
);

function saveSignal(symbol, plan) {
  try {
    let store = {
      signals: []
    };

    if (fs.existsSync(SIGNALS_FILE)) {
      try {
        store = JSON.parse(
          fs.readFileSync(SIGNALS_FILE, "utf8")
        );
      } catch {
        store = {
          signals: []
        };
      }
    }

    const signal = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      direction: plan.direction || null,
      entry: plan.entry ?? plan.trade?.entry ?? null,
      stop: plan.stop ?? plan.trade?.stop ?? null,
      target: plan.target ?? plan.trade?.target ?? null,
      riskReward:
        plan.riskReward ??
        plan.trade?.rr ??
        null,
      status: "ENTRY CONFIRMED",
      timeframe:
        plan.timeframe ||
        plan.executionTimeframe ||
        null,
      timestamp: new Date().toISOString()
    };

    store.signals.unshift(signal);

    store.signals = store.signals.slice(0, 50);

    fs.writeFileSync(
      SIGNALS_FILE,
      JSON.stringify(store, null, 2)
    );

    console.log(
      `🌐 SIGNAL SAVED FOR WEB: ${symbol} ${signal.direction}`
    );

    return signal;

  } catch (err) {
    console.log(
      "❌ Failed saving web signal:",
      err.message
    );

    return null;
  }
}
const access = require("./src/core/access");

const INTERVAL = 5 * 60 * 1000;

// Global WhatsApp alert cooldown.
// Change this number later if needed.
const GLOBAL_ALERT_COOLDOWN_MINUTES = 5;
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

  console.log("❌ WhatsApp socket not injected into scanner yet.");
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


function updateSignalLifecycle(symbol, currentPrice) {
  try {
    if (!fs.existsSync(SIGNALS_FILE)) {
      return;
    }

    const store = JSON.parse(
      fs.readFileSync(SIGNALS_FILE, "utf8")
    );

    if (!Array.isArray(store.signals)) {
      return;
    }

    const price = Number(currentPrice);

    if (!Number.isFinite(price)) {
      return;
    }

    let changed = false;

    for (const signal of store.signals) {
      if (
        signal.symbol !== symbol ||
        signal.status !== "ACTIVE"
      ) {
        continue;
      }

      const stop = Number(signal.stop);
      const target = Number(signal.target);

      if (
        !Number.isFinite(stop) ||
        !Number.isFinite(target)
      ) {
        continue;
      }

      const direction =
        String(signal.direction || "").toUpperCase();

      if (direction === "LONG") {

        if (price <= stop) {
          signal.status = "INVALIDATED";
          signal.invalidatedAt =
            new Date().toISOString();
          signal.updatedAt =
            signal.invalidatedAt;
          signal.exitPrice = price;

          console.log(
            `❌ ${symbol} LONG INVALIDATED @ ${price}`
          );

          changed = true;
          continue;
        }

        if (price >= target) {
          signal.status = "TARGET_HIT";
          signal.targetHitAt =
            new Date().toISOString();
          signal.updatedAt =
            signal.targetHitAt;
          signal.exitPrice = price;

          console.log(
            `🎯 ${symbol} LONG TARGET HIT @ ${price}`
          );

          changed = true;
          continue;
        }
      }

      if (direction === "SHORT") {

        if (price >= stop) {
          signal.status = "INVALIDATED";
          signal.invalidatedAt =
            new Date().toISOString();
          signal.updatedAt =
            signal.invalidatedAt;
          signal.exitPrice = price;

          console.log(
            `❌ ${symbol} SHORT INVALIDATED @ ${price}`
          );

          changed = true;
          continue;
        }

        if (price <= target) {
          signal.status = "TARGET_HIT";
          signal.targetHitAt =
            new Date().toISOString();
          signal.updatedAt =
            signal.targetHitAt;
          signal.exitPrice = price;

          console.log(
            `🎯 ${symbol} SHORT TARGET HIT @ ${price}`
          );

          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(
        SIGNALS_FILE,
        JSON.stringify(store, null, 2)
      );
    }

  } catch (error) {
    console.error(
      "❌ Signal lifecycle error:",
      error.message
    );
  }
}

async function analyze(symbol) {
  try {
    const result =
      await marketEngine.analyzeMarket(symbol);

    // Keep existing signals synchronized with live price.
    updateSignalLifecycle(
      symbol,
      result?.price
    );

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

    // Save the exact confirmed signal for the web dashboard.
    saveSignal(
      symbol,
      result.tradePlan
    );

    // Existing WhatsApp delivery remains unchanged.
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

  if (!activeWhatsAppSocket) {
    console.log("⏳ Waiting for WhatsApp socket...");
    return;
  }

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
