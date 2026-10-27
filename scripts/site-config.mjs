// CI helper for the extra sites in sites.json (each group's own site, apart from Jay's production
// and the test site): writes wrangler.<id>.json, production's configuration with that site's own
// Worker, D1 database (found, or created on its first deploy), domain and name. Every later wrangler
// command for the site takes --config wrangler.<id>.json.
// Usage: node scripts/site-config.mjs <id>
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const id = process.argv[2];
const site = JSON.parse(readFileSync("sites.json", "utf8")).find((s) => s.id === id);
if (!site) throw new Error(`site ${id} is not in sites.json`);

const name = `jaysbadminton-${id}`;
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
const find = () => JSON.parse(wrangler("d1", "list", "--json")).find((db) => db.name === name);
let db = find();
if (!db) {
  console.log(`Creating D1 database ${name}`);
  wrangler("d1", "create", name);
  db = find();
}
if (!db) throw new Error(`D1 database ${name} not found after create`);

// wrangler.jsonc only has whole-line comments.
const base = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
delete base.env;
const config = {
  ...base,
  name,
  d1_databases: [{ ...base.d1_databases[0], database_name: name, database_id: db.uuid }],
  vars: { ...base.vars, SITE_ORIGIN: `https://${site.domain}`, SITE_ID: id, SITE_NAME: site.name },
  routes: [{ pattern: site.domain, custom_domain: true }],
};
writeFileSync(`wrangler.${id}.json`, JSON.stringify(config, null, 2));
// The smoke test and the release notice in the later CI steps check this site.
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SITE_ORIGIN=https://${site.domain}\n`);
console.log(`Using Worker ${name}, D1 database ${name} (${db.uuid}), https://${site.domain}`);
