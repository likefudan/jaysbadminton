// One-off: read the 拍照登记 / 球场图 test photos with several Azure deployments, using the site's own
// prompts and schemas (lifted from the source so they are identical). Photos come from and results go
// to a private R2 prefix; nothing is printed but timings and status.
import { readFileSync } from "node:fs";

const HOST = "https://happy-badminton-jay-main-1.openai.azure.com";
const KEY = process.env.AZURE_FOUNDRY_API_KEY;
const CF = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/jaysbadminton-backups/objects`;
const PREFIX = process.env.PREFIX;
const cfh = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const objectAfter = (text, marker) => {
  const start = text.indexOf("{", text.indexOf(marker));
  let depth = 0;
  for (let i = start; ; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return eval(`(${text.slice(start, i + 1)})`);
  }
};
const templateAfter = (text, marker) => {
  const s = text.indexOf("`", text.indexOf(marker)) + 1;
  return text.slice(s, text.indexOf("`;", s));
};
const photoTs = src("worker/courtPhoto.ts");
const mapTs = src("worker/courtMap.ts");
const PHOTO_SCHEMA = objectAfter(photoTs, "const SCHEMA =");
const photoPrompt = (accounts) => templateAfter(photoTs, "const prompt = (").replace("${accounts.join(\", \")}", accounts.join(", "));
const MAP_SCHEMA = objectAfter(mapTs, "const SCHEMA =");
const MAP_PROMPT = templateAfter(mapTs, "const PROMPT =").replace("${COURT_MAP_ITEMS_MAX}", "200");

const ACC24 = ["Zhewl","Sail","Mn","Natalie","Yongy","Vishnu","Joe","Sudhanshu","Niki","Xiaowenb","Dongs","Richard","Qingz","Naga","Kus","Nikhm","Han","Liam","Jiazl","Boyang","Jimmy","Jessy","Katie","Nikki","Sal","Peggy","Jayx","Lukec","Wenxi","Ryen"];
const ACC20 = ["Peggy","Jayx","Chris","Weicheng","Lukec","Haozha","Tommb","Ricel","Che","Doy","Wenxi","Orianne"];
const PHOTOS = [["q1024a", ACC24], ["q1024b", ACC24], ["q1020x", ACC20], ["q1020y", ACC20], ["q1020z", ACC20]];

async function r2get(name) {
  const r = await fetch(`${CF}/${PREFIX}/${name}`, { headers: cfh });
  if (!r.ok) throw new Error(`r2 get ${name}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString("base64");
}
async function r2put(name, body) {
  const r = await fetch(`${CF}/${PREFIX}/${name}`, { method: "PUT", headers: { ...cfh, "content-type": "application/json" }, body });
  console.log(`r2 put ${name}: ${r.status}`);
}

async function post(path, headers, body, ms) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${HOST}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, ms: Date.now() - t0, json, text: json ? undefined : text.slice(0, 500) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String(e) };
  }
}

// Exactly the site's call for this model (ai.ts): Claude through /anthropic, everything else through /responses.
async function siteCall(model, effort, text, image, schema, maxTokens, ms) {
  if (model.startsWith("claude-")) {
    const r = await post("/anthropic/v1/messages", { "x-api-key": KEY, "anthropic-version": "2023-06-01" }, {
      model, max_tokens: maxTokens,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text }] }],
      output_config: { effort, format: { type: "json_schema", schema } },
    }, ms);
    const b = r.json;
    return { ...r, path: "anthropic", usage: b?.usage && { input: b.usage.input_tokens, output: b.usage.output_tokens },
      answer: b?.content?.filter((c) => c.type === "text").map((c) => c.text).join(""), stop: b?.stop_reason, err: b?.error?.message };
  }
  const r = await post("/openai/v1/responses", { "api-key": KEY }, {
    model, max_output_tokens: maxTokens, reasoning: { effort },
    input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${image}` }, { type: "input_text", text }] }],
    text: { format: { type: "json_schema", name: "answer", schema, strict: true } },
  }, ms);
  const b = r.json;
  return { ...r, path: "responses", usage: b?.usage && { input: b.usage.input_tokens, output: b.usage.output_tokens },
    answer: (b?.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join(""),
    stop: b?.status, err: b?.error?.message };
}

// When the site's call fails: the plain chat-completions shape, to tell "model can't" from "site's call shape can't".
async function chatCall(model, text, image, schema, maxTokens, ms, withSchema = true) {
  const r = await post("/openai/v1/chat/completions", { "api-key": KEY }, {
    model, max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }, { type: "text", text: withSchema ? text : `${text}\n\nAnswer with only JSON matching this schema: ${JSON.stringify(schema)}` }] }],
    ...(withSchema ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema, strict: true } } } : {}),
  }, ms);
  const b = r.json;
  return { ...r, path: withSchema ? "chat+schema" : "chat-plain", usage: b?.usage && { input: b.usage.prompt_tokens, output: b.usage.completion_tokens },
    answer: b?.choices?.[0]?.message?.content, stop: b?.choices?.[0]?.finish_reason, err: b?.error?.message };
}

const ok = (r) => r.status === 200 && r.answer && (() => { try { JSON.parse(r.answer.replace(/^```(json)?|```$/g, "")); return true; } catch { return false; } })();

async function one(model, effort, text, image, schema, maxTokens, ms) {
  const tries = [await siteCall(model, effort, text, image, schema, maxTokens, ms)];
  if (!ok(tries[0]) && !model.startsWith("claude-")) {
    tries.push(await chatCall(model, text, image, schema, maxTokens, ms, true));
    if (!ok(tries[1])) tries.push(await chatCall(model, text, image, schema, maxTokens, ms, false));
  }
  for (const t of tries) delete t.json;
  return tries;
}

const dep = await fetch(`${HOST}/openai/deployments?api-version=2022-12-01`, { headers: { "api-key": KEY } }).then((r) => r.json());
const deployments = (dep.data ?? []).map((d) => ({ id: d.id, model: d.model, status: d.status }));
console.log("deployments:", deployments.map((d) => `${d.id} (${d.model}, ${d.status})`).join("; "));
const wanted = (process.env.MODELS || "").split(",").filter(Boolean);
const models = wanted.length ? wanted : [
  "claude-fable-5-1", "gpt-6.1-sol",
  ...deployments.filter((d) => /kimi|deepseek|moonshot/i.test(`${d.id} ${d.model}`) && d.status === "succeeded").map((d) => d.id),
];
console.log("testing:", models.join(", "));

const images = Object.fromEntries(await Promise.all([...PHOTOS.map(([n]) => n), "map"].map(async (n) => [n, await r2get(`${n}.jpg`)])));
const RUNS = Number(process.env.RUNS || 2);
const results = [];
await Promise.all(models.map(async (model) => {
  for (let run = 1; run <= RUNS; run++) {
    for (const [name, accounts] of PHOTOS) {
      const tries = await one(model, "low", photoPrompt(accounts), images[name], PHOTO_SCHEMA, 16000, 180_000);
      results.push({ use: "photo", model, run, photo: name, tries });
      console.log(`${model} photo ${name} run ${run}: ${tries.map((t) => `${t.path} ${t.status} ${t.ms}ms ${ok(t) ? "ok" : "fail"}`).join(" | ")}`);
    }
  }
  const tries = await one(model, "high", MAP_PROMPT, images.map, MAP_SCHEMA, 32000, 300_000);
  results.push({ use: "map", model, run: 1, photo: "map", tries });
  console.log(`${model} map: ${tries.map((t) => `${t.path} ${t.status} ${t.ms}ms ${ok(t) ? "ok" : "fail"}`).join(" | ")}`);
}));
await r2put("results.json", JSON.stringify({ deployments, results }));
