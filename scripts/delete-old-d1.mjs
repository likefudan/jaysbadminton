// One-off: deletes the two US East databases left behind by the move to US West (move-d1.mjs).
// Refuses unless each one still has the expected name and id, its US West copy exists, and no
// Worker is bound to it. Already gone: nothing to do.
import { execFileSync } from "node:child_process";

const OLD = [
  { name: "jaysbadminton", uuid: "ec653a4b-64a8-42a5-b1a2-e6a7dad60448", moved: "jaysbadminton-wnam" },
  { name: "jaysbadminton-staging", uuid: "000b1fa4-c13f-434f-9fe6-cbb9781a6c66", moved: "jaysbadminton-staging-wnam" },
];

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
const api = async (path, method = "GET") => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
};

const list = JSON.parse(wrangler("d1", "list", "--json"));
const bound = new Map();
for (const script of await api("/workers/scripts")) {
  const settings = await api(`/workers/scripts/${script.id}/settings`);
  for (const b of settings.bindings ?? []) if (b.type === "d1") bound.set(b.id ?? b.database_id, script.id);
}

for (const old of OLD) {
  const db = list.find((d) => d.uuid === old.uuid);
  if (!db) {
    console.log(`${old.name} (${old.uuid}) is already gone`);
    continue;
  }
  if (db.name !== old.name) throw new Error(`${old.uuid} is named ${db.name}, not ${old.name}: not deleting`);
  if (!list.some((d) => d.name === old.moved)) throw new Error(`${old.moved} does not exist: not deleting ${old.name}`);
  if (bound.has(old.uuid))
    throw new Error(`${old.name} is still bound to the Worker ${bound.get(old.uuid)}: not deleting`);
  console.log(`Deleting ${old.name} (${old.uuid})`);
  // By id through the API: wrangler would look the name up in wrangler.jsonc, which has a placeholder id.
  await api(`/d1/database/${old.uuid}`, "DELETE");
}

const left = JSON.parse(wrangler("d1", "list", "--json")).filter((d) => OLD.some((o) => o.uuid === d.uuid));
if (left.length) throw new Error(`still there: ${left.map((d) => d.name).join(", ")}`);
console.log("Done.");
