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
/** Runs that try to send it (Telegram down); a chat that blocked the bot can't hold it forever. */
const MAX_ATTEMPTS = 3;

/** Lines per language, and how many changes were left out (only when they are the bare titles). */
type Lines = Record<BotLang, string[]> & { more: number };

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

/**
 * The changes as plain lines in each language, or the titles themselves when Claude can't (with
 * how many more there are). Null when CI found no list, so the notice says nothing about changes.
 */
export async function describeChanges(env: Env, changes: string[]): Promise<Lines | null> {
  if (changes.length === 0) return null;
  const titles = changes.slice(0, MAX_LINES);
  const fallback: Lines = { "zh-CN": titles, "zh-TW": titles, en: titles, more: changes.length - titles.length };
  if (!env.ANTHROPIC_API_KEY) return fallback;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
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
    return { "zh-CN": zh, "zh-TW": tw, en, more: 0 };
  } catch (err) {
    console.error("release notes:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return fallback;
  }
}

export function releaseText(env: Env, tag: string, lines: Lines | null) {
  return (l: BotLang) => {
    const items = lines?.[l] ?? [];
    let body = "";
    if (lines && items.length) {
      body = `${bt(l, "这次的更新：")}\n${items.map((s) => `• ${escapeHtml(s)}`).join("\n")}`;
      if (lines.more) body += `\n${bt(l, "……还有 {n} 项改动", { n: lines.more })}`;
    } else if (lines) body = bt(l, "这次没有大家能看到的变化，只是内部改进。");
    const head = bt(l, "🚀 新版本 {tag} 已发布到正式网站", { tag: escapeHtml(tag) });
    return `${head}\n\n${body ? `${body}\n\n` : ""}${escapeHtml(env.SITE_ORIGIN)}`;
  };
}

/** How long one run may take to send a notice before another may pick it up. */
const LEASE_MS = 5 * 60_000;

interface Row {
  tag: string;
  changes: string;
  created_at: string;
  lines: string | null;
  delivered: string;
}

const parseList = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return []; // Unreadable: still say the version is out.
  }
};

/**
 * Sends every release notice CI recorded that hasn't reached everyone yet. A run takes a notice for
 * LEASE_MS, so CI's call and the cron never both send it; the lines are written once and kept, so
 * Claude is asked once per release. Chats that got it are remembered, so a retry only goes to the
 * ones Telegram refused; after MAX_ATTEMPTS runs it is given up. How many notices reached someone.
 */
export async function sendReleaseNotices(env: Env, at = new Date()): Promise<number> {
  const ts = at.toISOString();
  const { results } = await env.DB.prepare(
    `SELECT tag FROM release_notices WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < ?)
     ORDER BY created_at`,
  )
    .bind(ts)
    .all<{ tag: string }>();
  let n = 0;
  for (const { tag } of results) {
    const r = await env.DB.prepare(
      `UPDATE release_notices SET claimed_until = ?, attempts = attempts + 1
       WHERE tag = ? AND sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < ?)
       RETURNING tag, changes, created_at, lines, delivered, attempts`,
    )
      .bind(new Date(at.getTime() + LEASE_MS).toISOString(), tag, ts)
      .first<Row & { attempts: number }>();
    if (!r) continue;
    const finish = (done: boolean, delivered: string[]) =>
      env.DB.prepare("UPDATE release_notices SET delivered = ?, claimed_until = NULL, sent_at = ? WHERE tag = ?")
        .bind(JSON.stringify(delivered), done ? now() : null, tag)
        .run();
    const before = parseList(r.delivered);
    if (at.getTime() - Date.parse(r.created_at) > STALE_MS) {
      console.warn(`release notice for ${tag} dropped: recorded ${r.created_at}, never sent`);
      await finish(true, before);
      continue;
    }
    try {
      let lines = r.lines ? (JSON.parse(r.lines) as Lines | null) : undefined;
      if (lines === undefined) {
        lines = await describeChanges(env, parseList(r.changes));
        await env.DB.prepare("UPDATE release_notices SET lines = ? WHERE tag = ?")
          .bind(JSON.stringify(lines), tag)
          .run();
      }
      const { chats, delivered } = await sendToOwnerAndAdmins(env, releaseText(env, tag, lines), new Set(before));
      const all = [...before, ...delivered];
      const missing = chats.filter((c) => !all.includes(c));
      if (missing.length)
        console.error(`release notice for ${tag}: ${missing.length} chat(s) refused (run ${r.attempts})`);
      await finish(missing.length === 0 || r.attempts >= MAX_ATTEMPTS, all);
      if (delivered.length) n++;
    } catch (err) {
      console.error(`release notice for ${tag} failed:`, err);
      await finish(r.attempts >= MAX_ATTEMPTS, before);
    }
  }
  return n;
}
