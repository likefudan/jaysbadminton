import Anthropic from "@anthropic-ai/sdk";
import { AI_EFFORTS, AI_USES, type AiChoice, type AiEffort, type AiUse } from "../shared/ai";
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
  return { photo: pick("photo"), notes: pick("notes") };
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

interface Reader {
  name: string;
  read: (req: AiRequest) => Promise<unknown>;
}

const isClaude = (model: string) => model.startsWith("claude-");

function claudeReader(name: string, client: Anthropic, model: string, effort: AiEffort): Reader {
  return {
    name,
    async read(req) {
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
      if (response.stop_reason !== "end_turn") throw new Error(`stopped with ${response.stop_reason}`);
      return JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    },
  };
}

function responsesReader(apiKey: string, model: string, effort: AiEffort): Reader {
  return {
    name: `azure ${model}`,
    async read(req) {
      const res = await fetch(`${AZURE_HOST}/openai/v1/responses`, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json" },
        signal: AbortSignal.timeout(60_000),
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
      } | null;
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

/** The model the pick falls back to: quick and never down when the others are. */
const FALLBACK: AiChoice = { model: "claude-sonnet-5-5", effort: "low" };

/** Who to ask, in order: the pick, then Sonnet (both on Azure). */
async function readers(env: Env, use: AiUse): Promise<Reader[]> {
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (!apiKey) return [];
  // No retry inside a call: the fallback is the retry.
  const claude = new Anthropic({ apiKey, baseURL: `${AZURE_HOST}/anthropic`, timeout: 60_000, maxRetries: 0 });
  const reader = ({ model, effort }: AiChoice) =>
    isClaude(model) ? claudeReader(`azure ${model}`, claude, model, effort) : responsesReader(apiKey, model, effort);
  const pick = (await aiChoices(env))[use];
  return pick.model === FALLBACK.model ? [reader(pick)] : [reader(pick), reader(FALLBACK)];
}

export const aiEnabled = (env: Env) => !!env.AZURE_FOUNDRY_API_KEY;

/** The first answer any reader gives, parsed; undefined when none could (each failure logged). */
export async function askAi(env: Env, use: AiUse, req: AiRequest): Promise<unknown> {
  for (const r of await readers(env, use)) {
    try {
      return await r.read(req);
    } catch (err) {
      console.error(
        `ai ${use} (${r.name}):`,
        err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : err,
      );
    }
  }
  return undefined;
}
