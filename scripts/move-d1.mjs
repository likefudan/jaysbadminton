// One-off helper (Actions → Move database): copies the test site's D1 database into a new one in
// US West (WNAM), where the members are. A D1 database cannot change region or name, so the copy is
// a new database, <name>-wnam; scripts/resolve-d1.mjs uses it once it exists, so the next deploy of
// the test site switches over. The old database is left as it is: `undo` deletes the new one and
// the next deploy goes back.
// Whatever the site saves between the export here and that next deploy stays in the old database.
// Usage: node scripts/move-d1.mjs staging [undo|check]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SITES = { staging: "jaysbadminton-staging" };
const from = SITES[process.argv[2]];
if (!from) throw new Error(`unknown site ${process.argv[2]}`);
const to = `${from}-wnam`;
const undo = process.argv[3] === "undo";
// `check`: read the old database and write the files, without creating the new one.
const check = process.argv[3] === "check";

const wrangler = (...args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const exists = (name) => JSON.parse(wrangler("d1", "list", "--json")).some((db) => db.name === name);
// Several statements in one call (a call takes seconds): one list of rows per statement.
const queries = (name, sqls) =>
  JSON.parse(wrangler("d1", "execute", name, "--remote", "--json", "--command", sqls.join("; "))).map((r) => r.results);
const query = (name, sql) => queries(name, [sql])[0];

// Tables, indexes and row counts: what must be the same in the copy. Cloudflare's own _cf_ tables
// and SQLite's are not exported.
const OBJECTS =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name";
const snapshot = (name) => {
  const objects = query(name, OBJECTS);
  const tables = objects.filter((o) => o.type === "table").map((o) => o.name);
  const counts = queries(
    name,
    tables.map((t) => `SELECT COUNT(*) AS n FROM "${t}"`),
  );
  return {
    objects: objects.map((o) => `${o.type} ${o.name} ${(o.sql ?? "").replace(/\s+/g, " ")}`),
    rows: Object.fromEntries(tables.map((t, i) => [t, counts[i][0].n])),
  };
};

if (undo) {
  if (!exists(to)) throw new Error(`${to} does not exist`);
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to}; the next deploy uses ${from} again`);
  process.exit(0);
}

if (!exists(from)) throw new Error(`${from} does not exist`);
if (exists(to)) throw new Error(`${to} already exists: the database was moved before`);

// Photos (BLOB columns) do not fit in the export: it writes each row as one statement, and D1 takes
// statements up to 100 KB. Their rows are left out of the file and copied below in pieces.
const tables = query(from, OBJECTS)
  .filter((o) => o.type === "table")
  .map((o) => o.name);
const infos = queries(
  from,
  tables.map((t) => `PRAGMA table_info("${t}")`),
);
const photoTables = [];
tables.forEach((table, i) => {
  const columns = infos[i];
  const blobs = columns.filter((c) => c.type.toUpperCase() === "BLOB").map((c) => c.name);
  if (!blobs.length) return;
  const keys = columns.filter((c) => c.pk > 0).map((c) => c.name);
  if (!keys.length) throw new Error(`${table} has a BLOB column and no primary key`);
  photoTables.push({ table, blobs, keys, plain: columns.map((c) => c.name).filter((c) => !blobs.includes(c)) });
});
const PIECE = 40_000; // bytes of a photo per statement: 80 KB as hex
const LIMIT = 95_000;
const photoRows = (name, { table, blobs, keys }) => {
  const where = (row) => keys.map((k, i) => `"${k}" = ${row[`k${i}`]}`).join(" AND ");
  const ids = query(
    name,
    `SELECT ${keys.map((k, i) => `quote("${k}") AS k${i}`).join(", ")} FROM "${table}" ORDER BY 1`,
  );
  return ids.map((id) => ({ where: where(id), blobs }));
};
const photo = (name, { table, plain, blobs }, where) =>
  query(
    name,
    `SELECT ${[
      ...plain.map((c, i) => `quote("${c}") AS p${i}`),
      ...blobs.map((c, i) => `typeof("${c}") AS t${i}, hex("${c}") AS b${i}`),
    ].join(", ")} FROM "${table}" WHERE ${where}`,
  )[0];

const before = snapshot(from);
wrangler("d1", "export", from, "--remote", "--output", "move.sql");
const inserts = new RegExp(`^INSERT INTO "?(${photoTables.map((t) => t.table).join("|") || "-"})"?[ (]`);
const lines = readFileSync("move.sql", "utf8")
  .split("\n")
  .filter((line) => !inserts.test(line));
const long = lines.find((line) => Buffer.byteLength(line) > LIMIT);
if (long) throw new Error(`A statement in the export is too long for D1: ${long.slice(0, 40)}…`);
writeFileSync("move.sql", lines.join("\n"));

const photos = [];
const statements = [];
for (const t of photoTables) {
  for (const { where } of photoRows(from, t)) {
    const row = photo(from, t, where);
    photos.push({ t, where, row });
    const columns = [...t.plain, ...t.blobs].map((c) => `"${c}"`).join(", ");
    const values = [
      ...t.plain.map((_, i) => row[`p${i}`]),
      ...t.blobs.map((_, i) => `X'${row[`b${i}`].slice(0, PIECE * 2)}'`),
    ];
    statements.push(`INSERT INTO "${t.table}" (${columns}) VALUES (${values.join(", ")});`);
    t.blobs.forEach((c, i) => {
      for (let at = PIECE * 2; at < row[`b${i}`].length; at += PIECE * 2) {
        const piece = row[`b${i}`].slice(at, at + PIECE * 2);
        statements.push(`UPDATE "${t.table}" SET "${c}" = CAST("${c}" || X'${piece}' AS BLOB) WHERE ${where};`);
      }
    });
  }
}
console.log(`${photos.length} photo rows in ${photoTables.map((t) => t.table).join(", ") || "no tables"}`);

if (check) {
  console.log(`Check only: move.sql and photos.sql are written, ${to} is not created`);
  writeFileSync("photos.sql", statements.join("\n"));
  process.exit(0);
}
wrangler("d1", "create", to, "--location", "wnam");
try {
  wrangler("d1", "execute", to, "--remote", "--yes", "--file", "move.sql");
  if (statements.length) {
    writeFileSync("photos.sql", statements.join("\n"));
    wrangler("d1", "execute", to, "--remote", "--yes", "--file", "photos.sql");
  }
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
  // Every photo, byte for byte.
  let same = 0;
  for (const { t, where, row } of photos) {
    if (JSON.stringify(photo(to, t, where)) === JSON.stringify(row)) same++;
    else differences.push(`${t.table} ${where}: the photo in the copy is not the same`);
  }
  console.log(`${same} of ${photos.length} photo rows are the same byte for byte`);
  if (differences.length) throw new Error(`The copy is not the same:\n${differences.join("\n")}`);
} catch (error) {
  // A half-filled copy must not be left behind: the next deploy would use it.
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to} again`);
  throw error;
}
console.log(wrangler("d1", "info", to));
console.log(`${to} is a full copy of ${from}. The next deploy of the test site uses it.`);
