const OpenAI =
  require("openai");

const config =
  require("../config");

async function generate(prompt) {
  if (!config.openrouterKey) {
    throw new Error(
      "OpenRouter API key is not configured."
    );
  }

  const client =
    new OpenAI({
      apiKey: config.openrouterKey,
      baseURL:
        "https://openrouter.ai/api/v1"
    });

  const response =
    await client.chat.completions.create({
      model: config.openrouterModel,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

  return (
    response.choices?.[0]
      ?.message?.content || ""
  );
}

module.exports = {
  generate
};
