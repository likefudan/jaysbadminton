// One-off helper (Actions → Move database): copies the test site's D1 database into a new one in
// US West (WNAM), where the members are. A D1 database cannot change region or name, so the copy is
// a new database, <name>-wnam; scripts/resolve-d1.mjs uses it once it exists, so the next deploy of
// the test site switches over. The old database is left as it is: `undo` deletes the new one and
// the next deploy goes back.
// Whatever the site saves between the export here and that next deploy stays in the old database.
// Usage: node scripts/move-d1.mjs staging [undo]
import { execFileSync } from "node:child_process";

const SITES = { staging: "jaysbadminton-staging" };
const from = SITES[process.argv[2]];
if (!from) throw new Error(`unknown site ${process.argv[2]}`);
const to = `${from}-wnam`;
const undo = process.argv[3] === "undo";

const wrangler = (...args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const exists = (name) => JSON.parse(wrangler("d1", "list", "--json")).some((db) => db.name === name);
const query = (name, sql) =>
  JSON.parse(wrangler("d1", "execute", name, "--remote", "--json", "--command", sql))[0].results;

// Tables, indexes and row counts: what must be the same in the copy. Cloudflare's own _cf_ tables
// and SQLite's are not exported.
const OBJECTS =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name";
const snapshot = (name) => {
  const objects = query(name, OBJECTS);
  const rows = {};
  for (const o of objects) {
    if (o.type === "table") rows[o.name] = query(name, `SELECT COUNT(*) AS n FROM "${o.name}"`)[0].n;
  }
  return { objects: objects.map((o) => `${o.type} ${o.name} ${(o.sql ?? "").replace(/\s+/g, " ")}`), rows };
};

if (undo) {
  if (!exists(to)) throw new Error(`${to} does not exist`);
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to}; the next deploy uses ${from} again`);
  process.exit(0);
}

if (!exists(from)) throw new Error(`${from} does not exist`);
if (exists(to)) throw new Error(`${to} already exists: the database was moved before`);

const before = snapshot(from);
wrangler("d1", "export", from, "--remote", "--output", "move.sql");
wrangler("d1", "create", to, "--location", "wnam");
try {
  wrangler("d1", "execute", to, "--remote", "--yes", "--file", "move.sql");
  const copy = snapshot(to);
  const after = snapshot(from);
  const differences = [];
  if (JSON.stringify(copy.objects) !== JSON.stringify(before.objects)) {
    const missing = before.objects.filter((o) => !copy.objects.includes(o));
    const extra = copy.objects.filter((o) => !before.objects.includes(o));
    differences.push(`schema differs: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`);
  }
  for (const [table, n] of Object.entries(before.rows)) {
    // A table the site wrote to during the copy may differ between before and after: the copy must
    // match one of the two.
    const ok = copy.rows[table] === n || copy.rows[table] === after.rows[table];
    console.log(`${ok ? "ok  " : "DIFF"} ${table}: ${n} rows, copy ${copy.rows[table]}`);
    if (!ok) differences.push(`${table}: ${n} rows, copy has ${copy.rows[table]}`);
  }
  if (differences.length) throw new Error(`The copy is not the same:\n${differences.join("\n")}`);
} catch (error) {
  // A half-filled copy must not be left behind: the next deploy would use it.
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to} again`);
  throw error;
}
console.log(wrangler("d1", "info", to));
console.log(`${to} is a full copy of ${from}. The next deploy of the test site uses it.`);
