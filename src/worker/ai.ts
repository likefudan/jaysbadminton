import Anthropic from "@anthropic-ai/sdk";
import {
  AI_DAILY_CAP_DEFAULT,
  AI_DAILY_CAP_MAX,
  AI_EFFORTS,
  AI_USES,
  type AiChoice,
  type AiDaily,
  type AiEffort,
  type AiUse,
  aiCost,
  type PhotoUsage,
} from "../shared/ai";
import { pacificToUtc, toPacific } from "../shared/time";
import { getSettings } from "./db";
import type { Env } from "./env";
import { badRequest } from "./http";

/**
 * AI 模型 (Ke Li, 2026-10-27): 拍照登记 and the release notice's 发版说明 each use a model the Owner
 * or an admin picks in 设置 from what is deployed on Ke Li's Azure (Microsoft Foundry). Claude
 * deployments are called through Foundry's Anthropic Messages API; the others (GPT, Grok) through
 * its OpenAI Responses API, which Foundry doesn't offer for Claude, and those that refuse it (Kimi,
 * DeepSeek: no reasoning effort) through Chat Completions. When the pick fails, Sonnet 5.5
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

/** AI 每天上限 as set in 设置 (200 until changed). */
export async function aiDailyCap(env: Env): Promise<number> {
  const n = Number((await getSettings(env.DB, ["ai_daily_cap"])).ai_daily_cap);
  return Number.isInteger(n) && n >= 1 && n <= AI_DAILY_CAP_MAX ? n : AI_DAILY_CAP_DEFAULT;
}

/** The cap and how many photos the whole site has sent to a model since midnight (Pacific). */
export async function aiDaily(env: Env, at = new Date()): Promise<AiDaily> {
  const since = pacificToUtc(toPacific(at).date, "00:00");
  const [cap, row] = await Promise.all([
    aiDailyCap(env),
    env.DB.prepare("SELECT COUNT(DISTINCT request) AS n FROM ai_usage WHERE use = 'photo' AND created_at >= ?")
      .bind(since)
      .first<{ n: number }>(),
  ]);
  return { cap, used: row?.n ?? 0 };
}

/** Before a photo goes to a model: refused once the site has used up the day (the form still works by hand). */
export async function assertAiBudget(env: Env): Promise<void> {
  const { cap, used } = await aiDaily(env);
  if (used >= cap) throw badRequest(`今天全站的 AI 识别已经用完（每天最多 ${cap} 次），请手动填写，明天再用`);
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

/** How a non-Claude deployment takes a request: learnt on its first call, kept while the Worker runs. */
type OpenAiShape = "responses" | "chat" | "chat-plain";
const shapes = new Map<string, OpenAiShape>();

/**
 * Azure refusing the shape of a request (a parameter, response_format or the API itself), not its
 * content: e.g. "Unsupported parameter: 'reasoning.effort' is not supported with this model." A
 * missing deployment or a bad photo is not this, and goes straight to the fallback.
 */
const refusesShape = (status: number, message: string) =>
  (status === 400 || status === 404) && /unsupported|not supported|unrecognized request argument/i.test(message);

interface Answer {
  status: number;
  message: string;
  /** The answer's text, or why a 2xx answer can't be used. */
  text?: string;
  unusable?: string;
  usage?: Tokens;
}

async function postJson(url: string, apiKey: string, callMs: number, payload: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(callMs),
    body: JSON.stringify(payload),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

/** GPT, Grok…: the Responses API, with effort and a strict schema. */
async function viaResponses(
  apiKey: string,
  model: string,
  effort: AiEffort,
  callMs: number,
  req: AiRequest,
): Promise<Answer> {
  const { res, body } = await postJson(`${AZURE_HOST}/openai/v1/responses`, apiKey, callMs, {
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
  });
  const usage = body?.usage && { input: body.usage.input_tokens ?? 0, output: body.usage.output_tokens ?? 0 };
  const message = `${body?.error?.message ?? ""}`;
  if (!res.ok) return { status: res.status, message, usage };
  if (body?.status !== "completed") return { status: res.status, message, usage, unusable: `status ${body?.status}` };
  const text = ((body.output ?? []) as { type: string; content?: { type: string; text?: string }[] }[])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  return { status: res.status, message, text, usage };
}

/**
 * Kimi, DeepSeek…: Chat Completions, which these take where Responses refuses `reasoning.effort`
 * (tested on Ke Li's photos 2026-11-18). No effort: they have none to set. "chat-plain" is for a
 * model that won't take a schema either: the schema goes into the prompt instead.
 */
async function viaChat(apiKey: string, model: string, plain: boolean, callMs: number, req: AiRequest): Promise<Answer> {
  const text = plain
    ? `${req.text}\n\nAnswer with only a JSON object matching this JSON Schema, nothing else: ${JSON.stringify(req.schema)}`
    : req.text;
  const { res, body } = await postJson(`${AZURE_HOST}/openai/v1/chat/completions`, apiKey, callMs, {
    model,
    max_tokens: req.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          ...(req.image ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${req.image}` } }] : []),
          { type: "text", text },
        ],
      },
    ],
    ...(plain
      ? {}
      : {
          response_format: { type: "json_schema", json_schema: { name: "answer", schema: req.schema, strict: true } },
        }),
  });
  const usage = body?.usage && { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 };
  const message = `${body?.error?.message ?? ""}`;
  if (!res.ok) return { status: res.status, message, usage };
  const choice = body?.choices?.[0];
  if (choice?.finish_reason !== "stop")
    return { status: res.status, message, usage, unusable: `finished with ${choice?.finish_reason}` };
  return { status: res.status, message, text: `${choice?.message?.content ?? ""}`, usage };
}

/** The answer's JSON, also when a model wraps it in a ```json fence or a sentence. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw err;
    return JSON.parse(text.slice(start, end + 1));
  }
}

function openAiReader(apiKey: string, model: string, effort: AiEffort, callMs: number): Reader {
  return {
    name: `azure ${model}`,
    choice: { model, effort },
    async read(req, spent) {
      // Shape refusals come back within a second, so the tries fit in about one call's time.
      const total: Tokens = { input: 0, output: 0 };
      const order: OpenAiShape[] = ["responses", "chat", "chat-plain"];
      for (const shape of order.slice(order.indexOf(shapes.get(model) ?? "responses"))) {
        const a =
          shape === "responses"
            ? await viaResponses(apiKey, model, effort, callMs, req)
            : await viaChat(apiKey, model, shape === "chat-plain", callMs, req);
        if (a.usage) {
          total.input += a.usage.input;
          total.output += a.usage.output;
          spent({ ...total });
        }
        if (a.status >= 200 && a.status < 300) {
          shapes.set(model, shape);
          if (a.unusable) throw new Error(a.unusable);
          return parseJson(a.text ?? "");
        }
        if (!refusesShape(a.status, a.message)) throw new Error(`HTTP ${a.status} ${a.message}`);
        console.log(`ai ${model}: ${shape} refused (${a.status} ${a.message}), trying the next way`);
      }
      throw new Error(`${model}: no request shape accepted`);
    },
  };
}

/** Per call: the pick and the fallback together stay under a minute and a half of 识别中…. */
const CALL_MS = 45_000;

/** The model the pick falls back to: quick and never down when the others are. */
const FALLBACK: AiChoice = { model: "claude-sonnet-5-5", effort: "low" };

/** How a call may differ from the use's pick in 设置. */
export interface AiOptions {
  /** The event the call is for, in ai_usage. */
  eventId?: number;
  /** The call's id in ai_usage, when the caller wants to find its rows (aiRequestCost). */
  request?: string;
  /** Asked with this effort whatever 设置 says (the model stays the pick): 球场图 is read once and with care. */
  effort?: AiEffort;
  /** How long each reader may take, when more than the usual 45 seconds. */
  callMs?: number;
}

/** Who to ask, in order: the pick, then Sonnet (both on Azure). */
async function readers(env: Env, use: AiUse, opts: AiOptions): Promise<Reader[]> {
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (!apiKey) return [];
  // No retry inside a call: the fallback is the retry.
  const callMs = opts.callMs ?? CALL_MS;
  const claude = new Anthropic({ apiKey, baseURL: `${AZURE_HOST}/anthropic`, timeout: callMs, maxRetries: 0 });
  const reader = ({ model, effort }: AiChoice) =>
    isClaude(model)
      ? claudeReader(`azure ${model}`, claude, model, opts.effort ?? effort)
      : openAiReader(apiKey, model, opts.effort ?? effort, callMs);
  const pick = (await aiChoices(env))[use];
  return pick.model === FALLBACK.model ? [reader(pick)] : [reader(pick), reader(FALLBACK)];
}

export const aiEnabled = (env: Env) => !!env.AZURE_FOUNDRY_API_KEY;

/**
 * The first answer any reader gives, parsed; undefined when none could (each failure logged).
 * Every call is written to ai_usage with its tokens (拍照登记用量), under `eventId` when given.
 */
export async function askAi(env: Env, use: AiUse, req: AiRequest, opts: AiOptions = {}): Promise<unknown> {
  const request = opts.request ?? crypto.randomUUID();
  const list = await readers(env, use, opts);
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

/** What one askAi call is estimated to have cost in US$, the fallback's part too; null when a model has no price. */
export async function aiRequestCost(env: Env, request: string): Promise<number | null> {
  const { results } = await env.DB.prepare("SELECT model, input_tokens, output_tokens FROM ai_usage WHERE request = ?")
    .bind(request)
    .all<{ model: string; input_tokens: number; output_tokens: number }>();
  let total = 0;
  for (const r of results) {
    const cost = aiCost(r.model, r.input_tokens, r.output_tokens);
    if (cost === null) return null;
    total += cost;
  }
  return total;
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
