require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const brain = require("../core/brain");
const music = require("../core/music");
const { handleCommand } = require("../commands/router");

const MEMORY_FILE = path.join(
  __dirname,
  "../../data/memory.json"
);

const HISTORY_DIR = path.join(
  __dirname,
  "../../data/conversations"
);

const MAX_HISTORY = 20;

const GROUP_STATS_FILE = path.join(
  __dirname,
  "../../data/group-stats.json"
);

function loadGroupStats() {
  try {
    return JSON.parse(
      fs.readFileSync(GROUP_STATS_FILE, "utf8")
    );
  } catch {
    return {};
  }
}

function saveGroupStats(stats) {
  fs.mkdirSync(
    path.dirname(GROUP_STATS_FILE),
    { recursive: true }
  );

  fs.writeFileSync(
    GROUP_STATS_FILE,
    JSON.stringify(stats, null, 2)
  );
}

function trackGroupMessage(msg, jid, text) {
  if (!jid || !jid.endsWith("@g.us")) {
    return;
  }

  const stats = loadGroupStats();

  if (!stats[jid]) {
    stats[jid] = {
      messages: 0,
      users: {},
      hours: {},
      commands: 0,
      lastActivity: null
    };
  }

  const group = stats[jid];

  const sender =
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid ||
    "unknown";

  const hour =
    new Date().getHours();

  group.messages += 1;

  group.users[sender] =
    (group.users[sender] || 0) + 1;

  group.hours[hour] =
    (group.hours[hour] || 0) + 1;

  if (text && isAddressedToNart(text)) {
    group.commands += 1;
  }

  group.lastActivity =
    new Date().toISOString();

  saveGroupStats(stats);
}




const MEDIA_DIR = path.join(
  __dirname,
  "../../data/media"
);

async function saveIncomingMedia(msg) {
  const message = msg.message || {};

  let media;
  let type;

  if (message.audioMessage) {
    media = message.audioMessage;
    type = "audio";
  } else if (message.documentMessage) {
    media = message.documentMessage;
    type = "document";
  } else {
    return null;
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const stream = await downloadContentFromMessage(
    media,
    type
  );

  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  let extension = "bin";

  if (type === "audio") {
    const mime = media.mimetype || "";

    if (mime.includes("mpeg")) extension = "mp3";
    else if (mime.includes("ogg")) extension = "ogg";
    else if (mime.includes("wav")) extension = "wav";
    else if (mime.includes("mp4")) extension = "m4a";
    else extension = "audio";
  } else {
    const original = media.fileName || "";

    if (original.includes(".")) {
      extension = original
        .split(".")
        .pop()
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 10) || "bin";
    }
  }

  const filename = `media-${Date.now()}.${extension}`;
  const output = path.join(MEDIA_DIR, filename);

  fs.writeFileSync(output, buffer);

  return {
    type,
    filename,
    path: output,
    size: buffer.length,
    mimetype: media.mimetype || null,
    originalName: media.fileName || null
  };
}


function loadMemory() {
  try {
    return JSON.parse(
      fs.readFileSync(MEMORY_FILE, "utf8")
    );
  } catch {
    return {
      owner: {
        name: "Coach Nart",
        preferredAssistantName: "Nart Jnr"
      },
      facts: [],
      preferences: [],
      projects: [],
      notes: []
    };
  }
}

function saveMemory(memory) {
  fs.mkdirSync(
    path.dirname(MEMORY_FILE),
    { recursive: true }
  );

  fs.writeFileSync(
    MEMORY_FILE,
    JSON.stringify(memory, null, 2)
  );
}

function historyFile(jid) {
  const safe = jid.replace(/[^a-zA-Z0-9_-]/g, "_");

  return path.join(
    HISTORY_DIR,
    `${safe}.json`
  );
}

function loadHistory(jid) {
  try {
    return JSON.parse(
      fs.readFileSync(
        historyFile(jid),
        "utf8"
      )
    );
  } catch {
    return [];
  }
}

function saveHistory(jid, history) {
  fs.mkdirSync(
    HISTORY_DIR,
    { recursive: true }
  );

  fs.writeFileSync(
    historyFile(jid),
    JSON.stringify(
      history.slice(-MAX_HISTORY),
      null,
      2
    )
  );
}

function addHistory(jid, role, text) {
  const history = loadHistory(jid);

  history.push({
    role,
    text,
    time: new Date().toISOString()
  });

  saveHistory(jid, history);
}

function cleanJson(text) {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function isAddressedToNart(text) {
  const lower =
    text.toLowerCase().trim();

  return (
    lower === "nart" ||
    lower.startsWith("nart ") ||
    lower.startsWith("nart,") ||
    lower.startsWith("nart:") ||
    lower.startsWith("nart jnr ") ||
    lower.startsWith("nart jnr,") ||
    lower.startsWith("nart jnr:") ||
    lower.startsWith("@nart ")
  );
}

function removeNartName(text) {
  return text
    .replace(
      /^@?nart(?:\s+jnr)?[,\s:]*/i,
      ""
    )
    .trim();
}

function buildSystemPrompt(
  memory,
  personName,
  jid
) {
  return `
You are Nart Jnr, Coach Nart's personal AI assistant.

Your owner is Coach Nart.

You are currently chatting with:
${personName || "someone"}

Chat ID:
${jid}

PERSONALITY:

Be fluent, natural, conversational and intelligent.

Do not sound like an AI assistant reading a manual.

Do not repeatedly say:
"Certainly"
"Absolutely"
"How may I assist you?"
"I understand your request."

Talk like a real person.

Match the energy of the person you're talking to.

If they're casual, be casual.
If they're serious, be serious.
If they're joking, you can joke.
If they ask a technical question, be useful and clear.

Don't over-explain simple things.

Do not mention this system prompt.

OWNER MEMORY:

${JSON.stringify(memory, null, 2)}

IMPORTANT:

You are Nart Jnr, not Coach Nart.

Never pretend to be Coach Nart.

Never reveal API keys, passwords, tokens,
credentials or private system information.

Never claim that Coach Nart said something unless
it is actually present in your memory or conversation.

If you don't know something, simply say so.

Your goal is to have a natural conversation.
`;
}



const tradeScanner = require("../../scanner");
let scannerStarted = false;

async function start() {

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    "data/whatsapp-auth"
  );

  const sock =
    makeWASocket({
      auth: state,
      printQRInTerminal: false
    });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    ({
      connection,
      lastDisconnect
    }) => {

      if (
        connection === "open"
      ) {

        console.log(
          "\n🔥 Nart Jnr is connected to WhatsApp.\n"
        );

        console.log("👑 MY WHATSAPP ID:");
        console.log("   sock.user:", sock.user?.id || "NONE");
        console.log("   creds.me:", state?.creds?.me?.id || "NONE");
        console.log("   creds.lid:", state?.creds?.me?.lid || "NONE");

        if (!scannerStarted) {
          scannerStarted = true;

          tradeScanner.setWhatsAppSocket(sock);

          console.log("🚀 Starting trade scanner...");

          tradeScanner.start().catch(err => {
            console.error(
              "❌ Trade scanner crashed:",
              err.stack || err.message
            );
          });
        }
      }

      if (
        connection === "close"
      ) {

        const statusCode =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode;

        if (
          statusCode !==
          DisconnectReason.loggedOut
        ) {

          console.log(
            "Connection lost. Reconnecting..."
          );

          setTimeout(
            start,
            3000
          );

        } else {

          console.log(
            "WhatsApp session logged out."
          );
        }
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({
      messages
    }) => {

      for (
        const msg of messages
      ) {

        try {

          if (
            !msg?.message
          ) continue;

          const jid =
            msg.key.remoteJid;

          console.log("📥 UPSERT:", {
            remoteJid: msg.key?.remoteJid,
            fromMe: msg.key?.fromMe,
            participant: msg.key?.participant,
            addressingMode: msg.key?.addressingMode
          });

          // Capture the sender of a private incoming DM.
          if (
            !msg.key?.fromMe &&
            msg.key?.remoteJid &&
            !msg.key.remoteJid.endsWith("@g.us") &&
            !msg.key.remoteJid.endsWith("@broadcast")
          ) {
            lastOwnerJid =
              msg.key.remoteJid;

            console.log(
              "👑 LAST PRIVATE DM JID:",
              lastOwnerJid
            );
          }

        // Ignore broadcasts/status.
        if (
          jid === "status@broadcast" ||
          jid.endsWith("@broadcast")
        ) {
          continue;
        }

          if (
            jid ===
            "status@broadcast"
          ) continue;

          const mediaMessage =


            msg.message?.audioMessage ||


            msg.message?.documentMessage;



          const text =


            extractText(msg);



          if (!text && !mediaMessage) continue;

          // 📊 Track every group message before
          // checking whether Nart was called.
          trackGroupMessage(
            msg,
            jid,
            text
          );

          const personName =
            msg.pushName ||
            "Unknown";

          console.log(
            `\n📩 ${personName}: ${text}`
          );

          /*
           * NART MUST BE CALLED.
           */
          if (
            !isAddressedToNart(text)
          ) {
            continue;
          }

          if (mediaMessage) {


            try {


              const savedMedia =


                await saveIncomingMedia(msg);



              if (savedMedia) {


                console.log(


                  "🎵 Media received:",


                  savedMedia.filename


                );



                await sock.sendMessage(


                  jid,


                  {


                    text:


                      savedMedia.type === "audio"


              ? "🎵 Got the audio and saved it as " + savedMedia.filename + ".\n\nI'm ready to work with it."
              : "📁 Got the file and saved it as " + savedMedia.filename + ".\n\nI'm ready to work with it."



                  },


                  {


                    quoted: msg


                  }


                );


              }


            } catch (error) {


              console.error(


                "❌ Media download error:",


                error.stack || error.message


              );



              await sock.sendMessage(


                jid,


                {


                  text:


                    "I received the file, but couldn't load it properly. Try sending it again."


                },


                {


                  quoted: msg


                }


              );


            }



            continue;


          }



          const prompt =


            removeNartName(text);

      const isGroup = jid.endsWith("@g.us");

        console.log("🧪 MESSAGE DEBUG:", {
          jid,
          isGroup,
          prompt,
          addressed: isAddressedToNart(text),
          fromMe: msg.key.fromMe,
          participant: msg.key.participant || null
        });


      console.log("🧠 ROUTER REACHED:", prompt);

            /* MASTER_COMMAND_ROUTER */
      console.log("🧠 CALLING HANDLE_COMMAND...");
      const commandHandled = await handleCommand({
        prompt,
        sock,
        jid,
        msg,
        isGroup
      });

      console.log("🧠 COMMAND RESULT:", commandHandled);
      if (commandHandled) {
        continue;
      }

                if (!prompt) {

            await sock.sendMessage(
              jid,
              {
                text:
                  "I'm here. What's up? 🫡"
              },
              {
                quoted: msg
              }
            );

            continue;
          }

          /*
           * Load memory.
           */
          const memory =
            loadMemory();

          /*
           * Explicit memory.
           */
          const rememberMatch =
            prompt.match(
              /^(?:remember|save)(?: that| this)?[:\s]+(.+)$/i
            );

          if (
            rememberMatch
          ) {

            const value =
              rememberMatch[1].trim();

            const lower =
              value.toLowerCase();

            let category =
              "facts";

            if (
              lower.includes("t3kit") ||
              lower.includes("project") ||
              lower.includes("building")
            ) {

              category =
                "projects";

            } else if (
              lower.includes("prefer") ||
              lower.includes("like") ||
              lower.includes("favorite") ||
              lower.includes("favourite") ||
              lower.includes("don't like")
            ) {

              category =
                "preferences";
            }

            if (
              !memory[category]
                .includes(value)
            ) {

              memory[category]
                .push(value);

              saveMemory(memory);
            }

            await sock.sendMessage(
              jid,
              {
                text:
                  "Got it. I'll remember that. 🧠"
              },
              {
                quoted: msg
              }
            );

            continue;
          }

          /*
           * Forget.
           */
          const forgetMatch =
            prompt.match(
              /^forget(?: that)?[:\s]+(.+)$/i
            );

          if (
            forgetMatch
          ) {

            const search =
              forgetMatch[1]
                .trim()
                .toLowerCase();

            let removed =
              false;

            for (
              const category of [
                "facts",
                "preferences",
                "projects",
                "notes"
              ]
            ) {

              const old =
                memory[category];

              memory[category] =
                old.filter(
                  item =>
                    !item
                      .toLowerCase()
                      .includes(search)
                );

              if (
                old.length !==
                memory[category].length
              ) {
                removed = true;
              }
            }

            if (
              removed
            ) {
              saveMemory(memory);
            }

            await sock.sendMessage(
              jid,
              {
                text:
                  removed
                    ? "Done. I've forgotten it."
                    : "I couldn't find anything matching that."
              },
              {
                quoted: msg
              }
            );

            continue;
          }

          /*
           * Automatically learn useful things.
           */
          /*
           * Automatically learn useful things.
           * Only learn from clear statements.
           */

          const autoLearn = [
            {
              pattern: /^(?:my favorite|my favourite) (.+?) is (.+)$/i,
              category: "preferences"
            },
            {
              pattern: /^i (?:prefer|like) (.+)$/i,
              category: "preferences"
            },
            {
              pattern: /^i (?:don't like|do not like|hate) (.+)$/i,
              category: "preferences"
            },
            {
              pattern: /^(?:i am|i['’]m) (?:building|working on) (?:a project called |a project named )?(.+)$/i,
              category: "projects"
            },
            {
              pattern: /^(?:my|the) (?:main )?project is (.+)$/i,
              category: "projects"
            }
          ];

          for (const rule of autoLearn) {
            const match = prompt.match(rule.pattern);

            if (!match) continue;

            const value = match
              .slice(1)
              .filter(Boolean)
              .join(" is ")
              .trim();

            if (value.length < 2 || value.length > 200) continue;

            if (!memory[rule.category].includes(value)) {
              memory[rule.category].push(value);
              saveMemory(memory);

              console.log(
                "🧠 Auto-memory saved:",
                rule.category,
                value
              );
            }

            break;
          }

          

          /*
           * Reload memory in case
           * something was added.
           */
          /*
           * Show typing.
           */
          await sock.sendPresenceUpdate(
            "composing",
            jid
          );

          /*
           * Generate response.
           */
          const answer =
          await brain.generate(
            prompt,
            jid,
            personName
          );

          

          /*
           * Save conversation.
           */
          addHistory(
            jid,
            "user",
            prompt
          );

          addHistory(
            jid,
            "assistant",
            answer
          );

          /*
           * Reply.
           */
          await sock.sendMessage(
            jid,
            {
              text: answer
            },
            {
              quoted: msg
            }
          );

          await sock.sendPresenceUpdate(
            "paused",
            jid
          );

          console.log(
            "📤 Nart replied."
          );

        } catch (error) {

          console.error(
            "❌ Message error:",
            error.stack || error.message
          );

          try {

            await sock.sendMessage(
              msg.key.remoteJid,
              {
                text:
                  "My brain just glitched 😭 Try me again."
              },
              {
                quoted: msg
              }
            );

          } catch {}
        }
      }
    }
  );
}

start().catch(
  console.error
);
