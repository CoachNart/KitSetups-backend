const fs = require("fs");
const path = require("path");

const ACCESS_FILE = path.join(
  __dirname,
  "../../data/access.json"
);

function defaultData() {
  return {
    owner: {
      ids: []
    },
    approved: []
  };
}

function load() {
  try {
    return JSON.parse(
      fs.readFileSync(ACCESS_FILE, "utf8")
    );
  } catch {
    return defaultData();
  }
}

function save(data) {
  fs.mkdirSync(
    path.dirname(ACCESS_FILE),
    { recursive: true }
  );

  fs.writeFileSync(
    ACCESS_FILE,
    JSON.stringify(data, null, 2)
  );
}

function normalize(id) {
  if (!id) return null;
  return String(id).trim();
}

function addUnique(list, id) {
  id = normalize(id);

  if (!id) return false;
  if (list.includes(id)) return false;

  list.push(id);
  return true;
}

function remove(list, id) {
  id = normalize(id);

  const index = list.indexOf(id);

  if (index === -1) {
    return false;
  }

  list.splice(index, 1);
  return true;
}

function isOwner(id) {
  const data = load();
  id = normalize(id);

  return !!id && data.owner.ids.includes(id);
}

function isApproved(id) {
  const data = load();
  id = normalize(id);

  return (
    !!id &&
    (
      data.owner.ids.includes(id) ||
      data.approved.includes(id)
    )
  );
}

function registerOwner(id) {
  const data = load();

  if (addUnique(data.owner.ids, id)) {
    save(data);
    return true;
  }

  return false;
}

function approve(id) {
  const data = load();
  id = normalize(id);

  if (!id) return false;

  if (data.owner.ids.includes(id)) {
    return true;
  }

  if (addUnique(data.approved, id)) {
    save(data);
  }

  return true;
}

function revoke(id) {
  const data = load();
  id = normalize(id);

  if (!id) return false;

  if (data.owner.ids.includes(id)) {
    return false;
  }

  const changed = remove(
    data.approved,
    id
  );

  if (changed) {
    save(data);
  }

  return changed;
}

function list() {
  return load();
}

function identifySender({
  msg,
  jid,
  isGroup
}) {
  if (isGroup) {
    return (
      msg?.key?.participant ||
      msg?.participant ||
      null
    );
  }

  return (
    msg?.key?.participant ||
    jid ||
    msg?.key?.remoteJid ||
    null
  );
}

module.exports = {
  load,
  save,
  isOwner,
  isApproved,
  registerOwner,
  approve,
  revoke,
  list,
  identifySender
};
