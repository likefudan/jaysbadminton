// Makes a database backup (the .sql that `wrangler d1 export` writes, see scripts/backup-db.sh)
// importable. The export writes each row as one statement, and D1 takes statements up to 100 KB: a
// row with a photo (a BLOB column, e.g. member_avatars) is longer and the import stops with
// "statement too long: SQLITE_TOOBIG". This writes the same data with every photo row as a short
// INSERT followed by UPDATEs that add the photo 40 KB at a time, and checks, by loading both files
// into SQLite here, that the result holds exactly what the backup holds.
//
// Usage: node scripts/split-sql.mjs <backup.sql> <out.sql>
// Then:  npx wrangler d1 execute <new empty database> --remote --file <out.sql>
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/split-sql.mjs <backup.sql> <out.sql>");

const PIECE = 40_000; // bytes of a photo per statement: 80 KB as hex
const LIMIT = 95_000;

// The export creates tables in an order that foreign keys do not always allow, and says so with
// PRAGMA defer_foreign_keys; here they are simply off.
const load = (sql) => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  db.exec(sql);
  return db;
};
const OBJECTS =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name";
const tablesOf = (db) =>
  db
    .prepare(OBJECTS)
    .all()
    .filter((o) => o.type === "table")
    .map((o) => o.name);

const sql = readFileSync(input, "utf8");
const backup = load(sql);

const photoTables = [];
for (const table of tablesOf(backup)) {
  const columns = backup.prepare(`PRAGMA table_info("${table}")`).all();
  const blobs = columns.filter((c) => c.type.toUpperCase() === "BLOB").map((c) => c.name);
  if (!blobs.length) continue;
  const keys = columns.filter((c) => c.pk > 0).map((c) => c.name);
  if (!keys.length) throw new Error(`${table} has a BLOB column and no primary key`);
  photoTables.push({ table, blobs, keys, plain: columns.map((c) => c.name).filter((c) => !blobs.includes(c)) });
}

const inserts = new RegExp(`^INSERT INTO "?(${photoTables.map((t) => t.table).join("|") || "-"})"?[ (]`);
const lines = sql.split("\n").filter((line) => !inserts.test(line));
let rows = 0;
for (const { table, blobs, keys, plain } of photoTables) {
  const select = [
    ...keys.map((c, i) => `quote("${c}") AS k${i}`),
    ...plain.map((c, i) => `quote("${c}") AS p${i}`),
    // A NULL photo stays NULL: hex() would make it an empty one.
    ...blobs.map((c, i) => `"${c}" IS NULL AS n${i}, hex("${c}") AS b${i}`),
  ];
  for (const row of backup.prepare(`SELECT ${select.join(", ")} FROM "${table}" ORDER BY rowid`).all()) {
    rows++;
    const where = keys.map((k, i) => `"${k}" = ${row[`k${i}`]}`).join(" AND ");
    const columns = [...plain, ...blobs].map((c) => `"${c}"`).join(", ");
    const values = [
      ...plain.map((_, i) => row[`p${i}`]),
      ...blobs.map((_, i) => (row[`n${i}`] ? "NULL" : `X'${row[`b${i}`].slice(0, PIECE * 2)}'`)),
    ];
    lines.push(`INSERT INTO "${table}" (${columns}) VALUES (${values.join(", ")});`);
    blobs.forEach((c, i) => {
      for (let at = PIECE * 2; at < row[`b${i}`].length; at += PIECE * 2) {
        const piece = row[`b${i}`].slice(at, at + PIECE * 2);
        lines.push(`UPDATE "${table}" SET "${c}" = CAST("${c}" || X'${piece}' AS BLOB) WHERE ${where};`);
      }
    });
  }
}
const long = lines.find((line) => Buffer.byteLength(line) > LIMIT);
if (long) throw new Error(`A statement is still too long for D1: ${long.slice(0, 40)}…`);
const result = lines.join("\n");

// The same tables, indexes and rows, photos byte for byte.
const copy = load(result);
const dump = (db) => {
  const objects = db.prepare(OBJECTS).all();
  const data = {};
  for (const table of tablesOf(db)) {
    data[table] = db
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all()
      .map((row) =>
        JSON.stringify(row, (_, v) => (v instanceof Uint8Array ? `blob:${Buffer.from(v).toString("hex")}` : v)),
      );
  }
  return { objects, data };
};
const a = dump(backup);
const b = dump(copy);
if (JSON.stringify(a.objects) !== JSON.stringify(b.objects))
  throw new Error("The tables or indexes differ from the backup");
for (const [table, was] of Object.entries(a.data)) {
  if (JSON.stringify([...was].sort()) !== JSON.stringify([...(b.data[table] ?? [])].sort())) {
    throw new Error(`${table} differs from the backup`);
  }
}

writeFileSync(output, result);
const total = Object.values(a.data).reduce((n, t) => n + t.length, 0);
console.log(
  `${output}: ${Object.keys(a.data).length} tables, ${total} rows, the same as the backup; ${rows} rows of ${photoTables.map((t) => t.table).join(", ") || "no table"} written in pieces`,
);
