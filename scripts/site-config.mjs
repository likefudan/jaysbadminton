// CI helper for the extra sites in sites.json (each group's own site, apart from Jay's production
// and the test site): writes wrangler.<id>.json, production's configuration with that site's own
// Worker, D1 database (found, or created on its first deploy), domain and name. Every later wrangler
// command for the site takes --config wrangler.<id>.json.
// Usage: node scripts/site-config.mjs <id>
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

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
// The AI sponsor thanked in the footer is production's unless the site lists its own: "sponsor": null for
// none, or { "name": …, "url": … }.
if ("sponsor" in site) {
  delete config.vars.SPONSOR_NAME;
  delete config.vars.SPONSOR_URL;
  if (site.sponsor?.name) config.vars.SPONSOR_NAME = site.sponsor.name;
  if (site.sponsor?.url) config.vars.SPONSOR_URL = site.sponsor.url;
}
// Its own icon colour, "icon": "blue": the Worker serves the icons in public/site-icons/blue/ under the
// usual names (scripts/site-icons.cjs makes them), so those paths go through the Worker first.
if (site.icon) {
  if (!/^[a-z0-9-]+$/.test(site.icon)) throw new Error(`site ${id}: bad icon ${site.icon}`);
  const files = readdirSync(`src/web/public/site-icons/${site.icon}`);
  config.vars.SITE_ICON = site.icon;
  config.assets = {
    ...config.assets,
    run_worker_first: [...config.assets.run_worker_first, ...files.map((f) => `/${f}`)],
  };
}
writeFileSync(`wrangler.${id}.json`, JSON.stringify(config, null, 2));
// The smoke test and the release notice in the later CI steps check this site.
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SITE_ORIGIN=https://${site.domain}\n`);
console.log(`Using Worker ${name}, D1 database ${name} (${db.uuid}), https://${site.domain}`);
