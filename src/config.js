require("dotenv").config();

module.exports = {
  geminiKey: process.env.GEMINI_API_KEY || "",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",

  geminiModel:
    process.env.GEMINI_MODEL ||
    "gemini-3.6-flash",

  openrouterModel:
    process.env.OPENROUTER_MODEL ||
    "openrouter/free",

  ownerName:
    process.env.OWNER_NAME ||
    "Coach Nart",

  assistantName:
    process.env.ASSISTANT_NAME ||
    "KitSetups",

  maxHistory:
    Number(process.env.MAX_HISTORY || 16)
};
