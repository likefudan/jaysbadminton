// Helper for Actions → Move database: copies a site's D1 database into a new one in US West (WNAM),
// where the members are. A D1 database cannot change region or name, so the copy is a new database,
// <name>-wnam; scripts/resolve-d1.mjs uses it once it exists, so the next deploy switches over.
// The old database is left as it is.
//
//   node scripts/move-d1.mjs staging             copy and check; the workflow then deploys the test site
//   node scripts/move-d1.mjs staging undo        delete the copy; the next deploy goes back (then also take
//                                                `placement: off` out of env.staging in wrangler.jsonc)
//   node scripts/move-d1.mjs <site> check        read the old database and write the files only
//   node scripts/move-d1.mjs production          copy and check; the workflow then deploys the version
//                                                Jay's site runs, bound to the copy, within seconds
//   node scripts/move-d1.mjs production abort    after a failed deploy: delete the copy, unless the site
//                                                already uses it
//   node scripts/move-d1.mjs production finish   after the deploy: was the old database written to between
//                                                the copy and the switch? Then lock it against old versions
//
// Production is live while this runs. The copy is only kept when, once it is complete, every row of
// every table in it equals the old database at that moment; `finish` reads the old database again
// and fails loudly if anything in it changed after that (those changes are not in the copy and have
// to be carried over by hand). Run it at a quiet hour, not at :00, :15, :30 or :45 (the cron).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SITES = { staging: "jaysbadminton-staging", production: "jaysbadminton" };
const site = process.argv[2];
const from = SITES[site];
if (!from) throw new Error(`unknown site ${site}`);
const to = `${from}-wnam`;
const mode = process.argv[3] ?? "";
const MODES = { staging: ["", "undo", "check"], production: ["", "check", "abort", "finish"] };
if (!MODES[site].includes(mode)) throw new Error(`${site} has no ${mode}`);
const undo = mode === "undo";
const check = mode === "check";
// The name old versions must not find in d1_migrations: their check-migrations.mjs then refuses to
// deploy them onto the old database, which their resolve-d1.mjs would pick by its name.
const LOCK = `9999_moved_to_${to}.sql`;
const STATE = resolve("move-state.json");

// Run from an empty folder: in the repository, wrangler.jsonc would answer for the name
// "jaysbadminton" with the placeholder id it holds until CI fills it in.
const BIN = resolve("node_modules/.bin/wrangler");
const AWAY = mkdtempSync(join(tmpdir(), "move-d1-"));
const wrangler = (...args) => execFileSync(BIN, args, { cwd: AWAY, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const MOVE_SQL = resolve("move.sql");
const PHOTOS_SQL = resolve("photos.sql");
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

// Every row of every table, as one hash per table. Photos (BLOB columns) are left out here: they are
// compared byte for byte on their own.
const content = (name) => {
  const tables = query(name, OBJECTS)
    .filter((o) => o.type === "table")
    .map((o) => o.name);
  const infos = queries(
    name,
    tables.map((t) => `PRAGMA table_info("${t}")`),
  );
  const rows = queries(
    name,
    tables.map((t, i) => {
      const columns = infos[i].filter((c) => c.type.toUpperCase() !== "BLOB").map((c) => `"${c.name}"`);
      return `SELECT ${columns.join(", ")} FROM "${t}" ORDER BY rowid`;
    }),
  );
  return Object.fromEntries(
    tables.map((t, i) => [t, createHash("sha256").update(JSON.stringify(rows[i])).digest("hex")]),
  );
};
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => a[t] !== b[t]);

if (undo) {
  if (!exists(to)) throw new Error(`${to} does not exist`);
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to}; the next deploy uses ${from} again`);
  process.exit(0);
}

if (mode === "abort") {
  const copy = JSON.parse(wrangler("d1", "list", "--json")).find((db) => db.name === to);
  if (!copy) {
    console.log(`${to} does not exist: nothing to delete`);
    process.exit(0);
  }
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${from}/settings`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const settings = await response.json();
  if (!settings.success)
    throw new Error(`Cannot read which database ${from} uses; ${to} is left as it is: look before the next release`);
  const bound = settings.result.bindings.filter((b) => b.type === "d1").map((b) => b.id ?? b.database_id);
  if (bound.includes(copy.uuid)) {
    console.log(
      `::error::The deploy reported a failure, but ${from} already uses ${to}. Nothing was deleted: check the site by hand, then run finish.`,
    );
    process.exit(1);
  }
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`${from} still uses its old database. Deleted ${to}: nothing has changed.`);
  process.exit(0);
}

if (mode === "finish") {
  const was = JSON.parse(readFileSync(STATE, "utf8"));
  const now = content(from);
  const tables = changed(was, now);
  wrangler(
    "d1",
    "execute",
    from,
    "--remote",
    "--yes",
    "--command",
    `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${LOCK}')`,
  );
  console.log(`${from} is locked against versions from before the move (${LOCK} in its d1_migrations)`);
  if (tables.length) {
    console.log(
      `::error::${from} was written to after the copy, before the site switched: ${tables.join(", ")}. Those changes are not in ${to}: compare these tables in the two databases and carry them over by hand.`,
    );
    process.exit(1);
  }
  console.log(`Nothing was written to ${from} between the copy and the switch: ${to} has everything.`);
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
wrangler("d1", "export", from, "--remote", "--output", MOVE_SQL);
const inserts = new RegExp(`^INSERT INTO "?(${photoTables.map((t) => t.table).join("|") || "-"})"?[ (]`);
const lines = readFileSync(MOVE_SQL, "utf8")
  .split("\n")
  .filter((line) => !inserts.test(line));
const long = lines.find((line) => Buffer.byteLength(line) > LIMIT);
if (long) throw new Error(`A statement in the export is too long for D1: ${long.slice(0, 40)}…`);
writeFileSync(MOVE_SQL, lines.join("\n"));

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
  writeFileSync(PHOTOS_SQL, statements.join("\n"));
  process.exit(0);
}
wrangler("d1", "create", to, "--location", "wnam");
try {
  wrangler("d1", "execute", to, "--remote", "--yes", "--file", MOVE_SQL);
  if (statements.length) {
    writeFileSync(PHOTOS_SQL, statements.join("\n"));
    wrangler("d1", "execute", to, "--remote", "--yes", "--file", PHOTOS_SQL);
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
  // Every row, as the old database is now: what `finish` compares it with after the switch.
  const old = content(from);
  for (const table of changed(old, content(to))) differences.push(`${table}: the rows in the copy are not the same`);
  if (differences.length) throw new Error(`The copy is not the same:\n${differences.join("\n")}`);
  writeFileSync(STATE, JSON.stringify(old));
} catch (error) {
  // A half-filled copy must not be left behind: the next deploy would use it.
  wrangler("d1", "delete", to, "--skip-confirmation");
  console.log(`Deleted ${to} again`);
  throw error;
}
console.log(wrangler("d1", "info", to));
console.log(`${to} is a full copy of ${from}. The next deploy of the site uses it.`);
