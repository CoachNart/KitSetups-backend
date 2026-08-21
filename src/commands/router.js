const fs = require("fs");
const os = require("os");
const path = require("path");
const music = require("../core/music");
const marketEngine = require("../tools/marketEngine");
const { formatMarketAnalysis } = require("../tools/marketResponse");

const STATS_FILE = path.join(
  __dirname,
  "../../data/group-stats.json"
);

function normalizeCommand(text) {
  return (text || "")
    .trim()
    .replace(/\s+/g, " ");
}

function loadStats() {
  try {
    return JSON.parse(
      fs.readFileSync(STATS_FILE, "utf8")
    );
  } catch {
    return {};
  }
}

function saveStats(stats) {
  fs.mkdirSync(
    path.dirname(STATS_FILE),
    { recursive: true }
  );

  fs.writeFileSync(
    STATS_FILE,
    JSON.stringify(stats, null, 2)
  );
}

function getSenderJid({ msg, jid, isGroup }) {
  if (isGroup) {
    return (
      msg?.key?.participant ||
      msg?.participant ||
      null
    );
  }

  return jid;
}

function formatJid(jid) {
  if (!jid) return "Unknown";

  const raw = String(jid);

  // WhatsApp LID — don't pretend it's a phone number.
  if (raw.includes("@lid")) {
    return `WhatsApp LID: ${raw.split("@")[0].split(":")[0]}`;
  }

  const number = raw
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");

  if (!number) return "Unknown";

  return `+${number}`;
}

async function handleCommand({
  prompt,
  sock,
  jid,
  msg,
  isGroup
}) {
  const command = normalizeCommand(prompt);

  if (!command) return false;

  // =====================================================
  // ACCESS CONTROL
  // =====================================================

  const senderId = require("../core/access").identifySender({
    msg,
    jid,
    isGroup
  });

  // APPROVE USER
  if (/^(?:approve|allow)$/i.test(command)) {
    const access = require("../core/access");

    if (!access.isOwner(senderId)) {
      console.log("🔒 Unauthorized approve attempt:", senderId);
      return true;
    }

    const quotedParticipant =
      msg?.message?.extendedTextMessage?.contextInfo?.participant ||
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.participant ||
      null;

    if (!quotedParticipant) {
      await sock.sendMessage(
        jid,
        {
          text:
            "⚠️ Reply to the person's message with:\n\n" +
            "*Nart, approve*"
        },
        { quoted: msg }
      );

      return true;
    }

    access.approve(quotedParticipant);

    await sock.sendMessage(
      jid,
      {
        text:
          `✅ *ACCESS APPROVED*\n\n` +
          `User: ${quotedParticipant}\n\n` +
          `They can now use Nart Jnr.`
      },
      { quoted: msg }
    );

    console.log(
      "👑 OWNER APPROVED:",
      quotedParticipant
    );

    return true;
  }

  // REVOKE USER
  if (/^(?:revoke|remove)$/i.test(command)) {
    const access = require("../core/access");

    if (!access.isOwner(senderId)) {
      console.log("🔒 Unauthorized revoke attempt:", senderId);
      return true;
    }

    const quotedParticipant =
      msg?.message?.extendedTextMessage?.contextInfo?.participant ||
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.participant ||
      null;

    if (!quotedParticipant) {
      await sock.sendMessage(
        jid,
        {
          text:
            "⚠️ Reply to the person's message with:\n\n" +
            "*Nart, revoke*"
        },
        { quoted: msg }
      );

      return true;
    }

    const revoked =
      access.revoke(quotedParticipant);

    if (revoked) {
      await sock.sendMessage(
        jid,
        {
          text:
            `🚫 *ACCESS REVOKED*\n\n` +
            `User: ${quotedParticipant}`
        },
        { quoted: msg }
      );

      console.log(
        "🚫 OWNER REVOKED:",
        quotedParticipant
      );
    } else {
      await sock.sendMessage(
        jid,
        {
          text:
            `⚠️ This user does not currently have approved access.`
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // LIST ACCESS
  if (
    /^(?:access|access list|who has access)$/i.test(command)
  ) {
    const access = require("../core/access");

    if (!access.isOwner(senderId)) {
      console.log(
        "🔒 Unauthorized access-list attempt:",
        senderId
      );
      return true;
    }

    const data = access.list();

    const owners =
      data.owner?.ids?.length
        ? data.owner.ids
            .map(id => `👑 ${id}`)
            .join("\n")
        : "None";

    const approved =
      data.approved?.length
        ? data.approved
            .map(id => `✅ ${id}`)
            .join("\n")
        : "None";

    await sock.sendMessage(
      jid,
      {
        text:
          `🔐 *NART JNR ACCESS*\n\n` +
          `*OWNER*\n${owners}\n\n` +
          `*APPROVED USERS*\n${approved}`
      },
      { quoted: msg }
    );

    return true;
  }

  // =====================================================
  // MARKET ANALYSIS
  // =====================================================

  const marketMatch = command.match(
    /^(?:analyze|analyse|market|check)\s+([A-Za-z0-9]+)$/i
  );

  if (marketMatch) {
    let symbol = marketMatch[1].toUpperCase();

    if (!symbol.endsWith("USDT")) {
      symbol += "USDT";
    }

    try {
      console.log(`📊 Market analysis: ${symbol}`);

      const result =
        await marketEngine.analyzeMarket(symbol);

      const response =
        formatMarketAnalysis(result);

      await sock.sendMessage(
        jid,
        {
          text: response
        },
        { quoted: msg }
      );

      console.log(`✅ Market analysis sent: ${symbol}`);

    } catch (error) {
      console.error(
        "❌ Market analysis error:",
        error.stack || error.message
      );

      await sock.sendMessage(
        jid,
        {
          text:
            `😭 I couldn't analyze ${symbol} right now.\\n\\n` +
            `${error.message || "Market engine unavailable."}`
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // =====================================================
  // HELP
  // =====================================================

  if (
    /^(help|commands|menu|what can you do)$/i.test(command)
  ) {
    await sock.sendMessage(
      jid,
      {
        text:
`🤖 *NART JNR*

Here's what I can do:

🎵 *MUSIC*
• Nart, play <song>

👤 *PEOPLE*
• Nart, who am I?
• Nart, who is <name>

👥 *GROUPS*
• Nart, group info
• Nart, group stats
• Nart, activity
• Nart, members

🧠 *MEMORY*
• Nart, remember <something>

⚙️ *SYSTEM*
• Nart, status
• Nart, help

More commands coming. 🚀`
      },
      { quoted: msg }
    );

    return true;
  }

  // =====================================================
  // MUSIC
  // =====================================================

  const musicMatch = command.match(
    /^(?:play|play me|put on|listen to)\s+(.+)$/i
  );

  if (musicMatch) {
    const songQuery = musicMatch[1].trim();

    try {
      console.log("🎵 Playing:", songQuery);

      const result = await music.playMusic(songQuery);

      await sock.sendMessage(
        jid,
        {
          audio: fs.readFileSync(result.path),
          mimetype: "audio/mpeg",
          fileName: result.filename,
          ptt: false
        },
        { quoted: msg }
      );

      console.log(
        "✅ Music sent:",
        result.filename
      );

    } catch (error) {
      console.error(
        "❌ Music error:",
        error.stack || error.message
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "😭 I couldn't get that song right now. Try another one."
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // =====================================================
  // WHO AM I
  // =====================================================

  if (
    /^(who am i|my details|my info|who is me)$/i.test(
      command
    )
  ) {
    const senderJid = getSenderJid({
      msg,
      jid,
      isGroup
    });

    const name =
      msg?.pushName ||
      "Unknown";

    await sock.sendMessage(
      jid,
      {
        text:
`👤 *YOUR DETAILS*

Name: ${name}
Number: ${formatJid(senderJid)}
Chat: ${isGroup ? "Group" : "DM"}`
      },
      { quoted: msg }
    );

    return true;
  }

  // =====================================================
  // GROUP INFO
  // =====================================================

  if (
    /^(group info|group details)$/i.test(command)
  ) {
    if (!isGroup) {
      await sock.sendMessage(
        jid,
        {
          text:
            "👥 That command only works inside a group."
        },
        { quoted: msg }
      );

      return true;
    }

    try {
      const metadata =
        await sock.groupMetadata(jid);

      const admins =
        metadata.participants.filter(
          member =>
            member.admin === "admin" ||
            member.admin === "superadmin"
        ).length;

      await sock.sendMessage(
        jid,
        {
          text:
`👥 *GROUP INFO*

Name: ${metadata.subject || "Unknown"}
Members: ${metadata.participants.length}
Admins: ${admins}
Group ID: ${jid}

🟢 Nart Jnr is active here.`
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error(
        "❌ Group info error:",
        error
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "😭 I couldn't retrieve this group's information."
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // =====================================================
  // GROUP MEMBERS
  // =====================================================

  if (
    /^(members|group members|list members)$/i.test(
      command
    )
  ) {
    if (!isGroup) {
      await sock.sendMessage(
        jid,
        {
          text:
            "👥 That command only works inside a group."
        },
        { quoted: msg }
      );

      return true;
    }

    try {
      const metadata =
        await sock.groupMetadata(jid);

      const members =
        metadata.participants;

      const admins =
        members.filter(
          member =>
            member.admin === "admin" ||
            member.admin === "superadmin"
        );

      let text =
`👥 *${metadata.subject || "GROUP"}*

Members: ${members.length}

`;

      if (admins.length) {
        text += "👑 *Admins*\n";

        for (const admin of admins) {
          text += `• ${formatJid(admin.id)}\n`;
        }

        text += "\n";
      }

      text +=
        "🟢 Nart Jnr sees this group.";

      await sock.sendMessage(
        jid,
        { text },
        { quoted: msg }
      );

    } catch (error) {
      console.error(
        "❌ Members error:",
        error
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "😭 I couldn't retrieve the members."
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // =====================================================
  // GROUP ACTIVITY
  // =====================================================

  if (
    /^(group stats|activity|group activity|stats)$/i.test(
      command
    )
  ) {
    if (!isGroup) {
      await sock.sendMessage(
        jid,
        {
          text:
            "👥 Activity tracking only works inside groups."
        },
        { quoted: msg }
      );

      return true;
    }

    const stats = loadStats();

    const group =
      stats[jid] || {
        messages: 0,
        users: {}
      };

    const users =
      Object.entries(group.users || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    let text =
`📊 *GROUP ACTIVITY*

Messages tracked: ${group.messages || 0}

🔥 *Top contributors*
`;

    if (!users.length) {
      text +=
        "No activity recorded yet.";
    } else {
      for (
        const [user, count]
        of users
      ) {
        text +=
          `• ${formatJid(user)} — ${count} messages\n`;
      }
    }

    await sock.sendMessage(
      jid,
      { text },
      { quoted: msg }
    );

    return true;
  }

  // =====================================================
  // MEMORY
  // =====================================================

  const rememberMatch =
    command.match(
      /^(?:remember|save)(?: that| this)?[:\s]+(.+)$/i
    );

  if (rememberMatch) {
    const value =
      rememberMatch[1].trim();

    const memoryFile =
      path.join(
        __dirname,
        "../../data/memory.json"
      );

    let memory;

    try {
      memory = JSON.parse(
        fs.readFileSync(
          memoryFile,
          "utf8"
        )
      );
    } catch {
      memory = {
        facts: [],
        preferences: [],
        projects: [],
        notes: []
      };
    }

    if (!memory.notes) {
      memory.notes = [];
    }

    if (!memory.notes.includes(value)) {
      memory.notes.push(value);
    }

    fs.mkdirSync(
      path.dirname(memoryFile),
      { recursive: true }
    );

    fs.writeFileSync(
      memoryFile,
      JSON.stringify(
        memory,
        null,
        2
      )
    );

    await sock.sendMessage(
      jid,
      {
        text:
          `🧠 Got it. I'll remember that.\n\n"${value}"`
      },
      { quoted: msg }
    );

    return true;
  }

  // =====================================================
  // STATUS
  // =====================================================

  if (
    /^(status|system status|bot status)$/i.test(
      command
    )
  ) {
    const memory =
      process.memoryUsage();

    await sock.sendMessage(
      jid,
      {
        text:
`⚙️ *NART JNR STATUS*

🟢 WhatsApp: Connected
🧠 Process: Running
💾 Memory: ${Math.round(
  memory.rss / 1024 / 1024
)} MB
💻 Host: ${os.hostname()}
📱 Mode: ${isGroup ? "Group" : "DM"}`
      },
      { quoted: msg }
    );

    return true;
  }

  return false;
}

module.exports = {
  handleCommand
};
