// One-off: every Azure deployment through the site's own askAi (this branch's ai.ts), on one queue
// photo and one text request. Prints only model, path, time, whether it answered and whether the
// fallback had to step in.
import { askAi, azureDeployments } from "../../src/worker/ai";

const CF = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/jaysbadminton-backups/objects`;
const image = Buffer.from(
  await (await fetch(`${CF}/tmp-model-test-/q1024a.jpg`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } })).arrayBuffer(),
).toString("base64");

let settings: Record<string, string> = {};
const usage: unknown[][] = [];
const DB = {
  prepare(sql: string) {
    let args: unknown[] = [];
    const st = {
      bind(...a: unknown[]) {
        args = a;
        return st;
      },
      async all() {
        return { results: args.filter((k) => typeof k === "string" && k in settings).map((k) => ({ key: k, value: settings[k as string] })) };
      },
      async run() {
        if (sql.includes("INSERT INTO ai_usage")) usage.push(args);
        return {};
      },
      async first() {
        return null;
      },
    };
    return st;
  },
};
const env = { AZURE_FOUNDRY_API_KEY: process.env.AZURE_FOUNDRY_API_KEY, DB } as any;
const SCHEMA = {
  type: "object",
  properties: { courts: { type: "array", items: { type: "integer" } } },
  required: ["courts"],
  additionalProperties: false,
};
const NOTE_SCHEMA = { type: "object", properties: { english: { type: "string" } }, required: ["english"], additionalProperties: false };

const models = await azureDeployments(env);
console.log("deployments:", models.join(", "));
await Promise.all(
  models.map(async (model) => {
    for (const [use, req] of [
      ["photo", { text: "List the court numbers shown on this badminton queue screen.", image, schema: SCHEMA, maxTokens: 4000 }],
      ["notes", { text: "Translate into English: 球场排队加了拍照登记", schema: NOTE_SCHEMA, maxTokens: 2000 }],
    ] as const) {
      settings = { ...settings, [`ai_${use}_model`]: model, [`ai_${use}_effort`]: "low" };
      const before = usage.length;
      const t0 = Date.now();
      const answer = (await askAi(env, use, req as any)) as any;
      const rows = usage.slice(before).filter((r) => r[3] === model || r[5] === 1);
      const own = rows.find((r) => r[3] === model && r[5] === 0);
      const fellBack = rows.some((r) => r[5] === 1);
      const summary = answer ? (use === "photo" ? `${answer.courts?.length} courts` : "translated") : "no answer";
      console.log(`RESULT ${model} ${use}: ${own?.[8] ? "OK" : "FAILED"}${fellBack ? " (fallback used)" : ""} ${Date.now() - t0}ms ${summary}`);
    }
  }),
);
