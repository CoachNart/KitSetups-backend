const fs = require("fs");
const path = require("path");

const DIR = path.join(
  __dirname,
  "../../data/conversations"
);

const MAX_HISTORY = 16;

function file(jid) {
  const safe =
    jid.replace(/[^a-zA-Z0-9_-]/g, "_");

  return path.join(
    DIR,
    `${safe}.json`
  );
}

function load(jid) {
  try {
    return JSON.parse(
      fs.readFileSync(file(jid), "utf8")
    );
  } catch {
    return [];
  }
}

function add(jid, role, text) {
  const history = load(jid);

  history.push({
    role,
    text,
    time: Date.now()
  });

  fs.mkdirSync(DIR, {
    recursive: true
  });

  fs.writeFileSync(
    file(jid),
    JSON.stringify(
      history.slice(-MAX_HISTORY),
      null,
      2
    )
  );
}

function format(history, person) {
  return history
    .map(item => {
      const name =
        item.role === "user"
          ? person || "Person"
          : "Nart";

      return `${name}: ${item.text}`;
    })
    .join("\n");
}

module.exports = {
  load,
  add,
  format
};
