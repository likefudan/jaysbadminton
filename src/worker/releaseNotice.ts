import Anthropic from "@anthropic-ai/sdk";
import { type BotLang, bt } from "./botLang";
import { now } from "./db";
import type { Env } from "./env";
import { escapeHtml, sendToOwnerAndAdmins } from "./telegram";

/**
 * 正式版发布通知 (Ke Li, 2026-10-20): when a production release has deployed, the Owner and every
 * admin are told in Telegram, each in their bot language, that a new version is live and what it
 * changed. CI (scripts/release-notice.mjs) records the version and the merged PR titles since the
 * previous release in release_notices, then calls POST /api/release-notice; the cron also looks, in
 * case that call didn't get through. Claude rewrites the titles as plain lines in 简/繁/EN; without
 * it the titles go out as they are.
 */
const MODEL = "claude-sonnet-5-5";
/** A notice CI recorded this long ago and never sent is old news: dropped, not announced late. */
const STALE_MS = 2 * 24 * 3600_000;
/** More than this many lines is a changelog, not a notice. */
const MAX_LINES = 10;

type Lines = Record<BotLang, string[]>;

const SCHEMA = {
  type: "object",
  properties: {
    simplified: { type: "array", items: { type: "string" } },
    traditional: { type: "array", items: { type: "string" } },
    english: { type: "array", items: { type: "string" } },
  },
  required: ["simplified", "traditional", "english"],
  additionalProperties: false,
};

const prompt = (
  changes: string[],
) => `这是一个羽毛球群的活动管理网站（报名、名单、分摊费用、付款、球场排队）。下面是这次正式版发布包含的改动（合并的 PR 标题，写给开发者看的）。
请把它们改写成发给群主和管理员的发布通知要点：
- 说用起来有什么不同：新功能、改了什么、修好了什么。不要提代码、PR 编号、数据库、测试、CI 这些。
- 纯内部的改动（测试、部署、文档、重构、开发工具）略去不写。
- 相关的几条合成一条。每条一句话，简短、口语化，不用 Markdown 或表情符号。
- 最多 ${MAX_LINES} 条，最重要的放前面。
- simplified 用简体中文，traditional 用台湾繁体中文，english 用英文；三种语言的条目一一对应、数量相同。
- 如果没有任何用户能感觉到的变化，三个数组都留空。

改动：
${changes.map((c) => `- ${c}`).join("\n")}`;

/** The changes as plain lines in each language; the titles themselves when Claude can't. */
export async function describeChanges(env: Env, changes: string[]): Promise<Lines> {
  const titles = changes.slice(0, MAX_LINES);
  const fallback: Lines = { "zh-CN": titles, "zh-TW": titles, en: titles };
  if (!env.ANTHROPIC_API_KEY || changes.length === 0) return fallback;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt(changes) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
    if (response.stop_reason !== "end_turn") throw new Error(`stopped: ${response.stop_reason}`);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const raw = JSON.parse(text) as Record<string, unknown>;
    const pick = (k: string) =>
      Array.isArray(raw[k])
        ? (raw[k] as unknown[])
            .filter((s): s is string => typeof s === "string" && s.trim() !== "")
            .map((s) => s.trim())
            .slice(0, MAX_LINES)
        : null;
    const zh = pick("simplified");
    const tw = pick("traditional");
    const en = pick("english");
    if (!zh || !tw || !en || tw.length !== zh.length || en.length !== zh.length) throw new Error("bad answer");
    return { "zh-CN": zh, "zh-TW": tw, en };
  } catch (err) {
    console.error("release notes:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return fallback;
  }
}

export function releaseText(env: Env, tag: string, lines: Lines) {
  return (l: BotLang) => {
    const items = lines[l];
    const body = items.length
      ? `${bt(l, "这次的更新：")}\n${items.map((s) => `• ${escapeHtml(s)}`).join("\n")}`
      : bt(l, "这次没有大家能看到的变化，只是内部改进。");
    return `${bt(l, "🚀 新版本 {tag} 已发布到正式网站", { tag: escapeHtml(tag) })}\n\n${body}\n\n${escapeHtml(env.SITE_ORIGIN)}`;
  };
}

/**
 * Sends every release notice CI recorded and nobody has sent yet. Each is claimed before it is
 * sent, so CI's call and the cron never both send it. How many notices went out.
 */
export async function sendReleaseNotices(env: Env, at = new Date()): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT tag, changes, created_at FROM release_notices WHERE sent_at IS NULL ORDER BY created_at",
  ).all<{ tag: string; changes: string; created_at: string }>();
  let n = 0;
  for (const r of results) {
    const claimed = await env.DB.prepare("UPDATE release_notices SET sent_at = ? WHERE tag = ? AND sent_at IS NULL")
      .bind(now(), r.tag)
      .run();
    if (claimed.meta.changes !== 1) continue;
    if (at.getTime() - Date.parse(r.created_at) > STALE_MS) continue;
    let changes: string[] = [];
    try {
      const parsed = JSON.parse(r.changes) as unknown;
      if (Array.isArray(parsed)) changes = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      // Unreadable list: still say the version is out.
    }
    await sendToOwnerAndAdmins(env, releaseText(env, r.tag, await describeChanges(env, changes)));
    n++;
  }
  return n;
}
