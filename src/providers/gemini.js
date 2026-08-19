const { GoogleGenAI } =
  require("@google/genai");

const config =
  require("../config");

async function generate(prompt) {
  if (!config.geminiKey) {
    throw new Error(
      "Gemini API key is not configured."
    );
  }

  const ai =
    new GoogleGenAI({
      apiKey: config.geminiKey
    });

  const result =
    await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt
    });

  return result.text;
}

module.exports = {
  generate
};
