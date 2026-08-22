const { spawn } = require("child_process");

console.log("🚀 Starting KitSetups API + Trade Scanner...");

const api = spawn(
  process.execPath,
  ["api.js"],
  { stdio: "inherit" }
);

const scanner = spawn(
  process.execPath,
  ["scanner.js"],
  { stdio: "inherit" }
);

function shutdown() {
  api.kill("SIGTERM");
  scanner.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

api.on("exit", code => {
  console.log(`❌ API exited with code ${code}`);
  process.exit(code ?? 1);
});

scanner.on("exit", code => {
  console.log(`❌ Scanner exited with code ${code}`);
  process.exit(code ?? 1);
});
