// CI helper: find (or create) the production D1 database and write its id into wrangler.jsonc,
// replacing the all-zero placeholder used for local development and tests.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "jaysbadminton";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
const find = () => JSON.parse(wrangler("d1", "list", "--json")).find((db) => db.name === NAME);

let db = find();
if (!db) {
  console.log(`Creating D1 database ${NAME}`);
  wrangler("d1", "create", NAME);
  db = find();
}
if (!db) throw new Error(`D1 database ${NAME} not found after create`);

const config = readFileSync("wrangler.jsonc", "utf8");
if (!config.includes(PLACEHOLDER)) throw new Error("database_id placeholder missing from wrangler.jsonc");
writeFileSync("wrangler.jsonc", config.replace(PLACEHOLDER, db.uuid));
console.log(`Using D1 database ${NAME} (${db.uuid})`);
