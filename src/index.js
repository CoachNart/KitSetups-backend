const brain =
  require("./core/brain");

const memory =
  require("./core/memory");

const context =
  require("./core/context");

async function main() {
  const prompt =
    process.argv.slice(2).join(" ");

  if (!prompt) {
    console.log(
      'Usage: node src/index.js "Nart, hello"'
    );
    return;
  }

  const jid =
    "cli-owner";

  const person =
    "Coach Nart";

  const lower =
    prompt.toLowerCase();

  const rememberMatch =
    prompt.match(
      /^nart[,:\s]+remember(?: that)?\s+(.+)$/i
    );

  if (rememberMatch) {

    const value =
      rememberMatch[1].trim();

    memory.remember(
      value,
      "notes"
    );

    console.log(
      "🧠 Memory saved:",
      value
    );

    return;
  }

  const forgetMatch =
    prompt.match(
      /^nart[,:\s]+forget(?: that)?\s+(.+)$/i
    );

  if (forgetMatch) {

    const removed =
      memory.forget(
        forgetMatch[1]
      );

    console.log(
      removed
        ? "🧠 Memory forgotten."
        : "I couldn't find that memory."
    );

    return;
  }

  const clean =
    prompt.replace(
      /^nart(?:\s+jnr)?[,\s:]*/i,
      ""
    ).trim();

  const answer =
    await brain.generate(
      clean,
      jid,
      person
    );

  context.add(
    jid,
    "user",
    clean
  );

  context.add(
    jid,
    "assistant",
    answer
  );

  console.log(
    `\nNart Jnr: ${answer}`
  );
}

main().catch(error => {
  console.error(
    "Nart Jnr error:",
    error.message
  );
});
