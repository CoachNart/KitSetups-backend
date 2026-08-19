const config = require("../config");
const memory = require("./memory");
const context = require("./context");
const gemini = require("../providers/gemini");
const openrouter = require("../providers/openrouter");

function systemPrompt(person, jid) {
  const saved = memory.load();

  return `
You are ${config.assistantName}, Coach Nart's personal AI assistant.

OWNER:
${config.ownerName}

CURRENT PERSON:
${person || "Unknown"}

CHAT ID:
${jid}

PERSONALITY:
Be natural, fluent, sharp and conversational.
You are not a generic customer-support bot.
Match the person's energy.
You can joke, be serious, explain things, challenge ideas and have normal conversations.
Do not sound robotic.
Do not repeatedly use phrases like "Certainly", "Absolutely", or "How may I assist you?"

You are Nart Jnr.
Never pretend to be Coach Nart.

OWNER MEMORY:
${JSON.stringify(saved, null, 2)}

PRIVACY:
Never reveal API keys, credentials, WhatsApp authentication data or private system data.
Do not invent facts about Coach Nart.
If you don't know something, say so naturally.
`;
}

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error.message) return String(error.message);

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function generate(prompt, jid, person) {
  const history = context.load(jid);

  const conversation = context.format(
    history,
    person
  );

  const fullPrompt = `
${systemPrompt(person, jid)}

RECENT CONVERSATION:
${conversation || "(new conversation)"}

CURRENT MESSAGE:
${prompt}

Reply naturally and directly.
Continue the conversation instead of restarting it.
`;

  // 🚀 OpenRouter is the primary provider.
  if (config.openrouterKey) {
    try {
      return await openrouter.generate(fullPrompt);
    } catch (error) {
      console.log(
        "⚠️ OpenRouter unavailable:",
        errorText(error)
      );
    }
  }

  // 🛟 Gemini is only a backup.
  if (config.geminiKey) {
    try {
      console.log("🛟 Trying Gemini fallback...");
      return await gemini.generate(fullPrompt);
    } catch (error) {
      console.log(
        "❌ Gemini fallback failed:",
        errorText(error)
      );
    }
  }

  throw new Error(
    "All configured AI providers are unavailable."
  );
}

module.exports = {
  generate
};
