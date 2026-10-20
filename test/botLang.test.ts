/// <reference types="vite/client" />
import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_MESSAGES } from "../src/worker/botMessages";
import { botDate, bt, btm, chatLang } from "../src/worker/botLang";
import { ROLE_TITLE } from "../src/worker/organizers";
import { runScheduled } from "../src/worker/notify";
import { digestText } from "../src/worker/health";
import { webhookSecret } from "../src/worker/telegram";
import type { EventRow } from "../src/worker/events";
import { ORIGIN, createTestEvent, futureDate, setUpAdmin } from "./helpers";

const sources = import.meta.glob("../src/worker/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CALL = /\b(?:bt\(\s*l,|t\()\s*"((?:[^"\\]|\\.)*)"/g;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Keys that reach bt() as data rather than as a literal in the call. */
const DATA_KEYS = [
  ROLE_TITLE.owner,
  ROLE_TITLE.admin,
  ROLE_TITLE.organizer,
  "历史收款人",
  "测试站",
  "正式网站",
  "Venmo 通知邮箱",
  "（空）",
  "自动记账",
  "部分付款",
  "多付",
  "待确认",
  "无关收款（已忽略）",
  "异常",
  "这场由 {name} 负责，但组织者功能已关闭，这条发给群主。",
  "{title} {name} 还没连接 Telegram，这条发给群主。",
  "这次活动还没结算",
];

describe("bot translations", () => {
  it("has 繁體 and English for every text the bot looks up, with the same placeholders", () => {
    const missing: string[] = [];
    for (const src of Object.values(sources))
      for (const m of src.matchAll(CALL)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!BOT_MESSAGES[key]) missing.push(key);
      }
    for (const key of DATA_KEYS) if (!BOT_MESSAGES[key]) missing.push(key);
    expect(missing).toEqual([]);
    for (const [zh, { tw, en }] of Object.entries(BOT_MESSAGES)) {
      expect(placeholders(tw), zh).toEqual(placeholders(zh));
      expect(placeholders(en), zh).toEqual(placeholders(zh));
      expect(en, zh).not.toMatch(/[一-鿿]/.test(zh) && !/收款|设置|待审核|简体|繁體/.test(en) ? /[一-鿿]/ : /$^/);
    }
  });

  it("fills in names and dates in the chosen language", () => {
    expect(bt("en", "{name} 还差 {amount}", { name: "Ann", amount: "$5.00" })).toBe("Ann still owes $5.00");
    expect(bt("zh-TW", "{name} 还差 {amount}", { name: "Ann", amount: "$5.00" })).toBe("Ann 還差 $5.00");
    expect(bt("zh-CN", "{name} 还差 {amount}", { name: "Ann", amount: "$5.00" })).toBe("Ann 还差 $5.00");
    expect(botDate("en", "2026-10-07")).toBe("Wed, Oct 7, 2026");
    expect(botDate("zh-TW", "2026-10-07")).toBe("2026年10月7日 週三");
    expect(botDate("zh-CN", "2026-10-07")).toBe("2026年10月7日 周三");
  });

  it("translates a 待确认 reason kept in Chinese, names and all", () => {
    expect(btm("en", "这次活动已取消")).toBe("This event was cancelled");
    expect(btm("en", "备注里的名字和编号 m1234 不是同一个人")).toBe(
      "The name in the note and the code m1234 are not the same person",
    );
    expect(btm("en", "没见过的原因")).toBe("没见过的原因");
    expect(btm("zh-CN", "这次活动已取消")).toBe("这次活动已取消");
  });
});

/** Telegram API calls the Worker made: method and JSON body. */
let calls: { method: string; body: any }[] = [];

beforeEach(() => {
  calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json({ ok: true, result: { username: "jb_test_bot", message_id: 1 } });
  });
});
afterEach(() => vi.restoreAllMocks());

const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body);
const connectChat = () => env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();

async function webhook(text: string, chatId = 42, from?: { language_code: string }) {
  return exports.default.fetch(`${ORIGIN}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": await webhookSecret(env) },
    body: JSON.stringify({ message: { text, from, chat: { id: chatId, type: "private", first_name: "Ming" } } }),
  });
}

describe("「语言」 in the bot", () => {
  it("offers the three languages as buttons and keeps the one picked for this chat", async () => {
    await connectChat();
    expect(await chatLang(env, "42")).toBe("zh-CN");
    await webhook("语言");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ chat_id: "42" });
    expect(sent()[0].text).toContain("请选择");
    expect(sent()[0].reply_markup.keyboard[0].map((b: { text: string }) => b.text)).toEqual([
      "简体中文",
      "繁體中文",
      "English",
    ]);

    calls = [];
    await webhook("English");
    expect(await chatLang(env, "42")).toBe("en");
    expect(sent()[0].text).toBe("✅ Notifications will be in English from now on.");
    expect(sent()[0].reply_markup).toEqual({ remove_keyboard: true });

    calls = [];
    for (const word of ["/language", "Language", "語言"]) await webhook(word);
    expect(sent()).toHaveLength(3);
    expect(sent()[0].text).toContain("Choose the language");

    calls = [];
    await webhook("繁體中文");
    expect(await chatLang(env, "42")).toBe("zh-TW");
    expect(sent()[0].text).toBe("✅ 以後的通知都會用繁體中文。");
  });

  it("says nothing to a chat nobody connected", async () => {
    await connectChat();
    await webhook("语言", 99);
    await webhook("English", 99);
    expect(calls).toEqual([]);
    expect(await chatLang(env, "99")).toBe("zh-CN");
  });

  it("starts a newly connected chat in 繁體 when Telegram is set to it, and tells how to switch", async () => {
    const ctx = await setUpAdmin();
    const { link } = (await ctx.admin.call(`${ctx.base}/telegram/connect`, {})).data;
    calls = [];
    await webhook(`/start ${link.split("=")[1]}`, 42, { language_code: "zh-hant" });
    expect(await chatLang(env, "42")).toBe("zh-TW");
    expect(sent()[0].text).toContain("已連線");
    expect(sent()[0].text).toContain("傳送「語言」");
  });

  it("puts /language in the menu when connecting", async () => {
    const ctx = await setUpAdmin();
    await ctx.admin.call(`${ctx.base}/telegram/connect`, {});
    const menus = calls.filter((c) => c.method === "setMyCommands").map((c) => c.body);
    expect(menus.map((m) => m.commands.map((x: { command: string }) => x.command))).toEqual([
      ["admin", "language"],
      ["admin", "language"],
    ]);
    expect(menus[1]).toMatchObject({ language_code: "en" });
  });
});

describe("notices in the chat's language", () => {
  it("writes the notice in English but keeps the WeChat text Chinese", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    await webhook("English");
    const date = futureDate(3);
    const ev = await createTestEvent(ctx, { date, deadlineDate: date, deadlineTime: "08:00" });
    calls = [];
    const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(ev.id).first<EventRow>();
    // Just inside the default 6-hour reminder window.
    await runScheduled(env, new Date(new Date(row!.deadline_at).getTime() - 3 * 3600_000));
    const text = sent()[0].text as string;
    expect(text).toMatch(/^⏰ Sign-up for \w{3}, \w{3} \d+, \d{4} closes in about 3 h, 0 signed up so far\./);
    expect(text).toContain("—— Copy to WeChat ——");
    expect(text).toContain("羽毛球报名还剩 3 小时截止");
  });

  it("writes the weekly digest in the chosen language", async () => {
    const text = await digestText(env, new Date("2026-10-19T17:00:00Z"), "en");
    expect(text).toMatch(/^📊 Weekly digest \(7 days from Mon, Oct 12\)/);
    expect(text).toContain("✓ Scheduled jobs: OK");
    expect(await digestText(env, new Date("2026-10-19T17:00:00Z"))).toContain("📊 每周简报（10月12日 周一 起的 7 天）");
  });
});
