// CI helper: find (or create) the D1 database for an environment and write its id into
// wrangler.jsonc, replacing the placeholder used for local development and tests.
// Usage: node scripts/resolve-d1.mjs [production|staging]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// `moved`: the copy of the database in US West (scripts/move-d1.mjs), used once it exists. A D1
// database cannot change region or name.
const ENVS = {
  production: { name: "jaysbadminton", placeholder: "00000000-0000-0000-0000-000000000000" },
  staging: {
    name: "jaysbadminton-staging",
    moved: "jaysbadminton-staging-wnam",
    placeholder: "11111111-1111-1111-1111-111111111111",
  },
};
const target = process.argv[2] ?? "production";
const {
  name: NAME,
  moved: MOVED,
  placeholder: PLACEHOLDER,
} = ENVS[target] ??
(() => {
  throw new Error(`unknown environment ${target}`);
})();

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
const list = () => JSON.parse(wrangler("d1", "list", "--json"));
const find = () => list().find((db) => db.name === NAME);

let db = (MOVED && list().find((d) => d.name === MOVED)) || find();
if (!db) {
  console.log(`Creating D1 database ${NAME}`);
  wrangler("d1", "create", NAME);
  db = find();
}
if (!db) throw new Error(`D1 database ${NAME} not found after create`);

const config = readFileSync("wrangler.jsonc", "utf8");
if (!config.includes(PLACEHOLDER)) throw new Error(`database_id placeholder for ${target} missing from wrangler.jsonc`);
writeFileSync("wrangler.jsonc", config.replace(PLACEHOLDER, db.uuid));
console.log(`Using D1 database ${db.name} (${db.uuid}) for ${target}`);
