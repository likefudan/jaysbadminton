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
