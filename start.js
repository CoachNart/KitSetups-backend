const { spawn } = require("child_process");

console.log("🚀 Starting Nart Jnr API + WhatsApp...");

const api = spawn(process.execPath, ["api.js"], {
  stdio: "inherit"
});

const whatsapp = spawn(
  process.execPath,
  ["src/whatsapp/index.js"],
  {
    stdio: "inherit"
  }
);

function shutdown() {
  api.kill("SIGTERM");
  whatsapp.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

api.on("exit", code => {
  console.log(`❌ API exited with code ${code}`);
  process.exit(code ?? 1);
});

whatsapp.on("exit", code => {
  console.log(`❌ WhatsApp exited with code ${code}`);
  process.exit(code ?? 1);
});
