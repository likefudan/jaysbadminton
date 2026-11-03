/** AI 模型 in 设置: what each use runs on (src/worker/ai.ts). */
export const AI_USES = ["photo", "notes"] as const;
export type AiUse = (typeof AI_USES)[number];
export const AI_USE_NAME: Record<AiUse, string> = { photo: "拍照登记", notes: "发版说明" };

export const AI_EFFORTS = ["low", "medium", "high"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export interface AiChoice {
  model: string;
  effort: AiEffort;
}

/**
 * 拍照登记用量: Anthropic's list prices in US$ per million tokens (checked 2026-11-03). Claude on
 * Azure (Microsoft Foundry) is billed at these rates; what the sponsor actually pays may differ, so
 * the page calls it an estimate. Deployments not listed here (GPT, Grok…) show tokens only.
 */
export const AI_PRICES: Record<string, { name: string; input: number; output: number }> = {
  "claude-fable-5-1": { name: "Fable 5.1", input: 10, output: 50 },
  "claude-fable-5": { name: "Fable 5", input: 10, output: 50 },
  "claude-opus-5-5": { name: "Opus 5.5", input: 4, output: 20 },
  "claude-opus-5": { name: "Opus 5", input: 5, output: 25 },
  "claude-sonnet-5-5": { name: "Sonnet 5.5", input: 2, output: 10 },
  "claude-sonnet-5": { name: "Sonnet 5", input: 2, output: 10 },
  "claude-haiku-5-5": { name: "Haiku 5.5", input: 0.1, output: 0.5 },
};

/** The estimated price of some tokens on a model, in US$; null when the model has no price. */
export function aiCost(model: string, input: number, output: number): number | null {
  const p = AI_PRICES[model];
  return p ? (input * p.input + output * p.output) / 1e6 : null;
}

/** 拍照登记用量 on the admin event page: one row per model (and whether it was the fallback). */
export interface AiUsageRow {
  model: string;
  effort: string;
  fallback: boolean;
  calls: number;
  input: number;
  output: number;
  /** US$, or null when the model has no price. */
  cost: number | null;
}

export interface PhotoUsage {
  /** Photos sent to be read (a photo the fallback read too counts once). */
  photos: number;
  /** Photos no model could read. */
  failed: number;
  tokens: number;
  /** US$, summed over the models that have a price; null when none has one. */
  cost: number | null;
  rows: AiUsageRow[];
}
