const fs = require("fs");
const path = require("path");

const FILE = path.join(
  __dirname,
  "../../data/memory.json"
);

const EMPTY = {
  owner: {
    name: "Coach Nart",
    preferredAssistantName: "Nart Jnr"
  },
  facts: [],
  preferences: [],
  projects: [],
  notes: []
};

function load() {
  try {
    return JSON.parse(
      fs.readFileSync(FILE, "utf8")
    );
  } catch {
    save(EMPTY);
    return structuredClone(EMPTY);
  }
}

function save(memory) {
  fs.mkdirSync(
    path.dirname(FILE),
    { recursive: true }
  );

  fs.writeFileSync(
    FILE,
    JSON.stringify(memory, null, 2)
  );
}

function remember(value, category = "facts") {
  const memory = load();

  if (!memory[category]) {
    memory[category] = [];
  }

  if (!memory[category].includes(value)) {
    memory[category].push(value);
    save(memory);
    return true;
  }

  return false;
}

function forget(search) {
  const memory = load();
  let removed = false;

  for (const category of [
    "facts",
    "preferences",
    "projects",
    "notes"
  ]) {
    const before = memory[category].length;

    memory[category] =
      memory[category].filter(
        item =>
          !item
            .toLowerCase()
            .includes(search.toLowerCase())
      );

    if (
      memory[category].length !== before
    ) {
      removed = true;
    }
  }

  if (removed) save(memory);

  return removed;
}

module.exports = {
  load,
  save,
  remember,
  forget
};
