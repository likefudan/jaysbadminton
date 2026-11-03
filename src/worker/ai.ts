import Anthropic from "@anthropic-ai/sdk";
import { AI_EFFORTS, AI_USES, type AiChoice, type AiEffort, type AiUse, aiCost, type PhotoUsage } from "../shared/ai";
import { getSettings } from "./db";
import type { Env } from "./env";

/**
 * AI 模型 (Ke Li, 2026-10-27): 拍照登记 and the release notice's 发版说明 each use a model the Owner
 * or an admin picks in 设置 from what is deployed on Ke Li's Azure (Microsoft Foundry). Claude
 * deployments are called through Foundry's Anthropic Messages API; the others (GPT, Grok) through
 * its OpenAI Responses API, which Foundry doesn't offer for Claude. When the pick fails, Sonnet 5.5
 * on the same Azure answers instead. Azure is the only provider: Ke Li removed the Anthropic API key
 * (2026-10-27).
 */
const AZURE_HOST = "https://happy-badminton-jay-main-1.openai.azure.com";

/** What each use runs on until someone picks: what it ran on before the menu (tested 2026-10-26). */
export const AI_DEFAULTS: Record<AiUse, AiChoice> = {
  photo: { model: "claude-fable-5-1", effort: "low" },
  notes: { model: "claude-sonnet-5-5", effort: "low" },
};

/** A deployment name as Azure allows it; anything else never reaches a URL or a request. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Where the pick is kept in settings. */
export const aiSettingKey = (use: AiUse, part: "model" | "effort") => `ai_${use}_${part}`;
const key = aiSettingKey;

export async function aiChoices(env: Env): Promise<Record<AiUse, AiChoice>> {
  const s = await getSettings(
    env.DB,
    AI_USES.flatMap((u) => [key(u, "model"), key(u, "effort")]),
  );
  const pick = (u: AiUse): AiChoice => {
    const model = s[key(u, "model")];
    const effort = s[key(u, "effort")] as AiEffort | undefined;
    return {
      model: model && MODEL_RE.test(model) ? model : AI_DEFAULTS[u].model,
      effort: effort && AI_EFFORTS.includes(effort) ? effort : AI_DEFAULTS[u].effort,
    };
  };
  return Object.fromEntries(AI_USES.map((u) => [u, pick(u)])) as Record<AiUse, AiChoice>;
}

/**
 * The deployments on the Azure resource that are ready to call, for the menu. The legacy
 * deployments list is the only one an API key can read (the newer one needs Azure sign-in).
 */
export async function azureDeployments(env: Env): Promise<string[]> {
  if (!env.AZURE_FOUNDRY_API_KEY) return [];
  const res = await fetch(`${AZURE_HOST}/openai/deployments?api-version=2022-12-01`, {
    headers: { "api-key": env.AZURE_FOUNDRY_API_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`deployments: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id?: unknown; status?: unknown }[] };
  return (body.data ?? [])
    .filter((d) => d.status === "succeeded" && typeof d.id === "string" && MODEL_RE.test(d.id))
    .map((d) => d.id as string)
    .sort();
}

export interface AiRequest {
  text: string;
  /** A JPEG, base64. */
  image?: string;
  /** JSON Schema of the answer: an object, every property required, no others. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

/** What a call used, as Azure reports it. */
interface Tokens {
  input: number;
  output: number;
}

interface Reader {
  name: string;
  choice: AiChoice;
  /** `spent` hears the tokens as soon as Azure reports them, also when the answer can't be used. */
  read: (req: AiRequest, spent: (t: Tokens) => void) => Promise<unknown>;
}

const isClaude = (model: string) => model.startsWith("claude-");

function claudeReader(name: string, client: Anthropic, model: string, effort: AiEffort): Reader {
  return {
    name,
    choice: { model, effort },
    async read(req, spent) {
      const response = await client.messages.create({
        model,
        max_tokens: req.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              ...(req.image
                ? [
                    {
                      type: "image" as const,
                      source: { type: "base64" as const, media_type: "image/jpeg" as const, data: req.image },
                    },
                  ]
                : []),
              { type: "text", text: req.text },
            ],
          },
        ],
        output_config: { effort, format: { type: "json_schema", schema: req.schema } },
      });
      spent({ input: response.usage.input_tokens, output: response.usage.output_tokens });
      if (response.stop_reason !== "end_turn") throw new Error(`stopped with ${response.stop_reason}`);
      return JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    },
  };
}

function responsesReader(apiKey: string, model: string, effort: AiEffort): Reader {
  return {
    name: `azure ${model}`,
    choice: { model, effort },
    async read(req, spent) {
      const res = await fetch(`${AZURE_HOST}/openai/v1/responses`, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json" },
        signal: AbortSignal.timeout(CALL_MS),
        body: JSON.stringify({
          model,
          max_output_tokens: req.maxTokens,
          reasoning: { effort },
          input: [
            {
              role: "user",
              content: [
                ...(req.image ? [{ type: "input_image", image_url: `data:image/jpeg;base64,${req.image}` }] : []),
                { type: "input_text", text: req.text },
              ],
            },
          ],
          text: { format: { type: "json_schema", name: "answer", schema: req.schema, strict: true } },
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        error?: { message?: string } | null;
        output?: { type: string; content?: { type: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      } | null;
      if (body?.usage) spent({ input: body.usage.input_tokens ?? 0, output: body.usage.output_tokens ?? 0 });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${body?.error?.message ?? ""}`);
      if (body?.status !== "completed") throw new Error(`status ${body?.status}`);
      const text = (body.output ?? [])
        .filter((o) => o.type === "message")
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text ?? "")
        .join("");
      return JSON.parse(text);
    },
  };
}

/** Per call: the pick and the fallback together stay under a minute and a half of 识别中…. */
const CALL_MS = 45_000;

/** The model the pick falls back to: quick and never down when the others are. */
const FALLBACK: AiChoice = { model: "claude-sonnet-5-5", effort: "low" };

/** Who to ask, in order: the pick, then Sonnet (both on Azure). */
async function readers(env: Env, use: AiUse): Promise<Reader[]> {
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (!apiKey) return [];
  // No retry inside a call: the fallback is the retry.
  const claude = new Anthropic({ apiKey, baseURL: `${AZURE_HOST}/anthropic`, timeout: CALL_MS, maxRetries: 0 });
  const reader = ({ model, effort }: AiChoice) =>
    isClaude(model) ? claudeReader(`azure ${model}`, claude, model, effort) : responsesReader(apiKey, model, effort);
  const pick = (await aiChoices(env))[use];
  return pick.model === FALLBACK.model ? [reader(pick)] : [reader(pick), reader(FALLBACK)];
}

export const aiEnabled = (env: Env) => !!env.AZURE_FOUNDRY_API_KEY;

/**
 * The first answer any reader gives, parsed; undefined when none could (each failure logged).
 * Every call is written to ai_usage with its tokens (拍照登记用量), under `eventId` when given.
 */
export async function askAi(env: Env, use: AiUse, req: AiRequest, opts: { eventId?: number } = {}): Promise<unknown> {
  const request = crypto.randomUUID();
  const list = await readers(env, use);
  for (const [i, r] of list.entries()) {
    let tokens: Tokens = { input: 0, output: 0 };
    const spent = (t: Tokens) => {
      tokens = t;
    };
    // A call that times out or errors before Azure reports usage is written with 0 tokens.
    const log = (ok: boolean) =>
      logUsage(env, { request, use, eventId: opts.eventId, choice: r.choice, fallback: i > 0, tokens, ok });
    try {
      const answer = await r.read(req, spent);
      await log(true);
      return answer;
    } catch (err) {
      console.error(
        `ai ${use} (${r.name}):`,
        err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : err,
      );
      await log(false);
    }
  }
  return undefined;
}

/** One call into ai_usage; a failure to write it is logged and never fails the call itself. */
async function logUsage(
  env: Env,
  u: {
    request: string;
    use: AiUse;
    eventId?: number;
    choice: AiChoice;
    fallback: boolean;
    tokens: Tokens;
    ok: boolean;
  },
) {
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (request, use, event_id, model, effort, fallback, input_tokens, output_tokens, ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        u.request,
        u.use,
        u.eventId ?? null,
        u.choice.model,
        u.choice.effort,
        u.fallback ? 1 : 0,
        u.tokens.input,
        u.tokens.output,
        u.ok ? 1 : 0,
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    console.error("ai usage not saved:", err instanceof Error ? err.message : err);
  }
}

/** 拍照登记用量 for the admin event page; null when nobody has sent a photo. */
export async function photoUsage(env: Env, eventId: number): Promise<PhotoUsage | null> {
  const [totalsRes, byModel] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS photos, COALESCE(SUM(ok = 0), 0) AS failed FROM
         (SELECT request, MAX(ok) AS ok FROM ai_usage WHERE event_id = ? AND use = 'photo' GROUP BY request)`,
    ).bind(eventId),
    env.DB.prepare(
      `SELECT model, effort, fallback, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
         FROM ai_usage WHERE event_id = ? AND use = 'photo'
         GROUP BY model, effort, fallback ORDER BY fallback, calls DESC, model`,
    ).bind(eventId),
  ]);
  const totals = totalsRes!.results[0] as { photos: number; failed: number } | undefined;
  if (!totals?.photos) return null;
  const results = byModel!.results as {
    model: string;
    effort: string;
    fallback: number;
    calls: number;
    input: number;
    output: number;
  }[];
  const rows = results.map((r) => ({
    model: r.model,
    effort: r.effort,
    fallback: r.fallback === 1,
    calls: r.calls,
    input: r.input,
    output: r.output,
    cost: aiCost(r.model, r.input, r.output),
  }));
  return {
    photos: totals.photos,
    failed: totals.failed,
    tokens: rows.reduce((n, r) => n + r.input + r.output, 0),
    cost: rows.some((r) => r.cost !== null) ? rows.reduce((n, r) => n + (r.cost ?? 0), 0) : null,
    rows,
  };
}
