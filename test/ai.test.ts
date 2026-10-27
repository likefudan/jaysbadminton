import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askAi, azureDeployments } from "../src/worker/ai";
import { describeChanges } from "../src/worker/releaseNotice";
import { setUpAdmin } from "./helpers";

/** 设置 → AI 模型: each use runs on the model picked from what is deployed on Azure. */

const HOST = "https://happy-badminton-jay-main-1.openai.azure.com";
const AZURE = { ...env, AZURE_FOUNDRY_API_KEY: "azure-key" };
const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

interface Call {
  url: string;
  key: string | null;
  body: any;
}

/** Azure answering `answer`; the models in `down` fail. */
function models(answer: object, down: string[] = []) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    const body = (req.method === "POST" ? await req.json() : null) as any;
    calls.push({ url: req.url, key: req.headers.get("api-key") ?? req.headers.get("x-api-key"), body });
    if (body && down.includes(body.model)) return Response.json({ error: { message: "down" } }, { status: 500 });
    if (req.url.startsWith(`${HOST}/openai/deployments`))
      return Response.json({
        data: [
          { id: "gpt-6.1-sol", status: "succeeded" },
          { id: "claude-fable-5-1", status: "succeeded" },
          { id: "claude-haiku-5-5", status: "failed" },
        ],
      });
    if (req.url === `${HOST}/openai/v1/responses`)
      return Response.json({
        status: "completed",
        output: [
          { type: "reasoning", content: [] },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] },
        ],
      });
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("AI 模型", () => {
  it("runs on the defaults until someone picks: Fable for photos, Sonnet for release notes", async () => {
    const calls = models({ ok: true });
    expect(await askAi(AZURE, "photo", { text: "hi", schema: SCHEMA, maxTokens: 100 })).toEqual({ ok: true });
    expect(await askAi(AZURE, "notes", { text: "hi", schema: SCHEMA, maxTokens: 100 })).toEqual({ ok: true });
    expect(calls.map((c) => [c.url, c.key, c.body.model, c.body.output_config.effort])).toEqual([
      [`${HOST}/anthropic/v1/messages`, "azure-key", "claude-fable-5-1", "low"],
      [`${HOST}/anthropic/v1/messages`, "azure-key", "claude-sonnet-5-5", "low"],
    ]);
  });

  it("lists what is deployed, and saves a pick per use that the next call follows", async () => {
    const ctx = await setUpAdmin();
    const calls = models({ ok: true });
    expect(await azureDeployments(AZURE)).toEqual(["claude-fable-5-1", "gpt-6.1-sol"]);
    expect(calls[0]!.key).toBe("azure-key");

    const r = await ctx.admin.call(`${ctx.base}/settings`, {
      ai: { photo: { model: "gpt-6.1-sol", effort: "medium" } },
    });
    expect(r.status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.ai).toEqual({
      photo: { model: "gpt-6.1-sol", effort: "medium" },
      notes: { model: "claude-sonnet-5-5", effort: "low" },
    });

    // GPT goes through the Responses API, with the photo as an image and the schema strict.
    calls.length = 0;
    expect(await askAi(AZURE, "photo", { text: "read", image: "AAAA", schema: SCHEMA, maxTokens: 100 })).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${HOST}/openai/v1/responses`);
    expect(calls[0]!.key).toBe("azure-key");
    expect(calls[0]!.body).toMatchObject({
      model: "gpt-6.1-sol",
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", strict: true, schema: SCHEMA } },
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
            { type: "input_text", text: "read" },
          ],
        },
      ],
    });

    // Bad picks are refused.
    for (const bad of [
      { model: "../x", effort: "low" },
      { model: "gpt-6.1-sol", effort: "max" },
    ])
      expect((await ctx.admin.call(`${ctx.base}/settings`, { ai: { notes: bad } })).status).toBe(400);
  });

  it("falls back to Sonnet on Azure when the pick fails, and gives up when that fails too", async () => {
    let calls = models({ ok: true }, ["claude-fable-5-1"]);
    expect(await askAi(AZURE, "photo", { text: "hi", schema: SCHEMA, maxTokens: 100 })).toEqual({ ok: true });
    expect(calls.map((c) => [c.url, c.body.model])).toEqual([
      [`${HOST}/anthropic/v1/messages`, "claude-fable-5-1"],
      [`${HOST}/anthropic/v1/messages`, "claude-sonnet-5-5"],
    ]);
    vi.restoreAllMocks();
    calls = models({ ok: true }, ["claude-fable-5-1", "claude-sonnet-5-5"]);
    expect(await askAi(AZURE, "photo", { text: "hi", schema: SCHEMA, maxTokens: 100 })).toBeUndefined();
    // Sonnet picked: nothing else to fall back to.
    vi.restoreAllMocks();
    calls = models({ ok: true }, ["claude-sonnet-5-5"]);
    expect(await askAi(AZURE, "notes", { text: "hi", schema: SCHEMA, maxTokens: 100 })).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("writes release notes with the model picked for them", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('ai_notes_model', 'gpt-6.1-sol'), ('ai_notes_effort', 'low')",
    ).run();
    const calls = models({ simplified: ["新功能"], traditional: ["新功能"], english: ["New"] });
    expect(await describeChanges(AZURE, ["改动"])).toEqual({
      "zh-CN": ["新功能"],
      "zh-TW": ["新功能"],
      en: ["New"],
      more: 0,
    });
    expect(calls.map((c) => [c.url, c.body.model])).toEqual([[`${HOST}/openai/v1/responses`, "gpt-6.1-sol"]]);
  });

  it("says when there is no Azure key", async () => {
    const ctx = await setUpAdmin();
    models({});
    expect((await ctx.admin.call(`${ctx.base}/settings/ai-models`)).data).toEqual({ models: [], ready: false });
  });
});
