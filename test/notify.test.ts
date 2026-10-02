import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pacificToUtc } from "../src/shared/time";
import { handleEmail, recordEmailOutcome } from "../src/worker/inbound";
import { digestText, emailProblemAlert } from "../src/worker/health";
import worker from "../src/worker/index";
import { runScheduled } from "../src/worker/notify";
import { webhookSecret } from "../src/worker/telegram";
import { ORIGIN, billingScenario, createTestEvent, futureDate, setUpAdmin } from "./helpers";
import { type ReceiptFields, testKey, venmoEmail } from "./venmoMail";

/** Telegram API calls the Worker made: method and JSON body. */
let calls: { method: string; body: any }[] = [];
let telegramOk = true;

beforeEach(() => {
  calls = [];
  telegramOk = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json(telegramOk ? { ok: true, result: { username: "jb_test_bot", message_id: 1 } } : { ok: false, description: "nope" });
  });
});
afterEach(() => vi.restoreAllMocks());

const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text as string);
const connectChat = () => env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
const pacific = (date: string, time: string) => new Date(pacificToUtc(date, time));

async function webhook(text: string, chatId = 42, secret?: string) {
  return exports.default.fetch(`${ORIGIN}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret ?? (await webhookSecret(env)) },
    body: JSON.stringify({ message: { text, chat: { id: chatId, type: "private", first_name: "Ming" } } }),
  });
}

describe("connecting Telegram", () => {
  it("binds only the chat that opens the one-time link, and sends a test message", async () => {
    const ctx = await setUpAdmin();
    const { link } = (await ctx.admin.call(`${ctx.base}/telegram/connect`, {})).data;
    expect(link).toMatch(/^https:\/\/t\.me\/jb_test_bot\?start=[A-Za-z0-9_-]{43}$/);
    const hook = calls.find((c) => c.method === "setWebhook")!.body;
    expect(hook).toMatchObject({ url: "https://jaysbadminton.llmat.dev/api/telegram/webhook", allowed_updates: ["message"] });
    const code = link.split("=")[1];

    expect((await webhook(`/start ${code}`, 42, "forged")).status).toBe(403);
    await webhook("/start wrong-code-wrong-code-wrong-code");
    await webhook("hello");
    expect((await ctx.admin.call(`${ctx.base}/telegram`)).data.connected).toBe(false);

    expect((await webhook(`/start ${code}`, 42)).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/telegram`)).data).toMatchObject({ connected: true, chatName: "Ming", botUsername: "jb_test_bot" });
    expect(calls.at(-1)!.body).toMatchObject({ chat_id: "42" });

    // The code is spent: someone else using it later changes nothing.
    await webhook(`/start ${code}`, 99);
    calls = [];
    expect((await ctx.admin.call(`${ctx.base}/telegram/test`, {})).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ chat_id: "42", parse_mode: "HTML" });
    expect(calls[0]!.body.text).toContain("<pre>");

    await ctx.admin.call(`${ctx.base}/telegram/disconnect`, {});
    expect((await ctx.admin.call(`${ctx.base}/telegram/test`, {})).status).toBe(400);
  });
});

describe("scheduled notifications", () => {
  it("reminds before the deadline once, then posts the roster when sign-up closes", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const date = futureDate(7);
    const e = await createTestEvent(ctx, { date, joinSelf: true }); // deadline: 1 day before 19:00
    await env.DB.prepare("UPDATE events SET created_at = '2000-01-01T00:00:00.000Z'").run();
    const deadline = new Date(e.deadlineAt);

    await runScheduled(env, new Date(deadline.getTime() - 7 * 3600_000)); // outside the 6 h window
    expect(sent()).toEqual([]);
    await runScheduled(env, new Date(deadline.getTime() - 5 * 3600_000));
    await runScheduled(env, new Date(deadline.getTime() - 4 * 3600_000));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain("报名还剩约 5 小时截止，目前 1 人");
    expect(sent()[0]).toContain(`https://jaysbadminton.llmat.dev/e/${e.code}`);

    await env.DB.prepare("UPDATE events SET status = 'closed'").run();
    await runScheduled(env, new Date(deadline.getTime() + 600_000));
    await runScheduled(env, new Date(deadline.getTime() + 1200_000));
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toContain("报名已截止，共 1 人");
    expect(sent()[1]).toContain("1. Jay");
  });

  it("closes sign-up and posts the roster in the run right after the deadline (the cron runs every minute)", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const e = await createTestEvent(ctx, { joinSelf: true });
    await env.DB.prepare("UPDATE events SET deadline_at = ? WHERE id = ?").bind(new Date(Date.now() - 20_000).toISOString(), e.id).run();
    const c = createExecutionContext();
    await worker.scheduled!({ scheduledTime: Date.now(), cron: "* * * * *", noRetry() {} } as ScheduledController, env, c);
    await waitOnExecutionContext(c);
    expect(sent()).toEqual([expect.stringContaining("报名已截止，共 1 人")]);
    expect((await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(e.id).first<{ status: string }>())!.status).toBe("closed");
  });

  it("skips the reminder when the event was created inside the window, or reminders are off", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const e = await createTestEvent(ctx);
    const deadline = new Date(e.deadlineAt).getTime();
    await env.DB.prepare("UPDATE events SET created_at = ?").bind(new Date(deadline - 3 * 3600_000).toISOString()).run();
    await runScheduled(env, new Date(deadline - 3600_000));
    expect(sent()).toEqual([]);

    await env.DB.prepare("UPDATE events SET created_at = '2000-01-01T00:00:00.000Z'").run();
    await ctx.admin.call(`${ctx.base}/settings`, { reminderEnabled: false });
    await runScheduled(env, new Date(deadline - 3600_000));
    expect(sent()).toEqual([]);
  });

  it("reminds hourly to settle after the event, but not at night", async () => {
    const s = await billingScenario();
    await connectChat();
    await runScheduled(env, pacific(s.e.date, "14:05")); // before the event ends: 21:00
    expect(sent().filter((t) => t.includes("还没有结算"))).toEqual([]);
    await env.DB.prepare("UPDATE events SET end_at = '2000-01-01T00:00:00.000Z'").run();
    await runScheduled(env, pacific(s.e.date, "14:05"));
    await runScheduled(env, pacific(s.e.date, "14:45"));
    await runScheduled(env, pacific(s.e.date, "15:05"));
    await runScheduled(env, pacific(s.e.date, "23:05"));
    expect(sent().filter((t) => t.includes("还没有结算"))).toHaveLength(2);
  });

  it("announces Finalize once, then sends daily dunning from 24 h later until stopped", async () => {
    const s = await billingScenario();
    await connectChat();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await s.admin.call(`${s.eb}/finalize`, s.fees); // a later save does not announce again
    const finalized = sent().filter((t) => t.includes("已结算"));
    expect(finalized).toHaveLength(1);
    expect(finalized[0]).toContain("Alice $56.00");
    expect(finalized[0]).toContain("费用已经出来了");

    calls = [];
    // Forwarding is healthy and the Monday digest is off: this test is about bill reminders only.
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('email_last_at', ?), ('weekly_digest', '0')").bind(new Date().toISOString()).run();
    const today = futureDate(0);
    await runScheduled(env, pacific(today, "10:05")); // less than 24 h after Finalize
    expect(sent()).toEqual([]);
    await env.DB.prepare("UPDATE events SET finalized_at = '2000-01-01T00:00:00.000Z'").run();
    await runScheduled(env, pacific(today, "09:55"));
    await runScheduled(env, pacific(today, "10:05"));
    await runScheduled(env, pacific(today, "10:15"));
    expect(sent()).toHaveLength(3); // summary + Alice + Bob
    expect(sent()[0]).toContain("应收 $118.00，已收 $31.00");
    expect(sent()[1]).toContain("Alice，");
    expect(sent()[1]).toContain("$56.00 还没付哦");
    expect(sent()[2]).toContain("Bob（微信：Bob）");

    calls = [];
    expect((await s.admin.call(`${s.eb}/dunning`, { stop: true })).data.dunningStopped).toBe(true);
    expect((await s.admin.call(s.eb)).data.dunningStopped).toBe(true);
    await runScheduled(env, pacific(futureDate(1), "10:05"));
    expect(sent()).toEqual([]);
  });

  it("retries on the next run when Telegram fails", async () => {
    const s = await billingScenario();
    await connectChat();
    await env.DB.prepare("UPDATE events SET end_at = '2000-01-01T00:00:00.000Z'").run();
    telegramOk = false;
    await runScheduled(env, pacific(s.e.date, "14:05"));
    telegramOk = true;
    calls = [];
    await runScheduled(env, pacific(s.e.date, "14:15"));
    expect(sent()).toHaveLength(1);
  });
});

describe("payment notifications", () => {
  it("tells the Owner when everything is collected", async () => {
    const s = await billingScenario();
    await connectChat();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const pays = (await s.admin.call(`${s.eb}/settlement`)).data.payments;
    for (const p of pays) if (p.status !== "paid") await s.admin.call(`${s.base}/payments/${p.id}/mark-paid`, {});
    const done = sent().filter((t) => t.includes("已全部收齐"));
    expect(done).toHaveLength(1);
    expect(done[0]).toContain(`日期：${s.e.date.slice(0, 4)}年`);
    expect(done[0]).toContain(`活动编号：jbm${s.e.date.replace(/-/g, "")}`);
    expect(done[0]).toContain("场馆：Bay Badminton Center");
    expect(done[0]).toContain("人数：报名 4 人，到场 3 人（3 人付款）");
    expect(done[0]).toContain("费用：$118.00");
    expect(done[0]).toContain("场地费 $100.00");
    expect(done[0]).toContain("球费 $18.00（6 个 × $3.00）");
    expect(done[0]).toContain("应收 $118.00，实收 $118.00");
  });

  it("stays silent without a connected chat", async () => {
    const s = await billingScenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    expect(calls).toEqual([]);
  });
});

describe("Venmo payment notifications", () => {
  it("reports 待确认, partial payments and over-payments as they arrive", async () => {
    const s = await billingScenario();
    await connectChat();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const { payments } = (await s.admin.call(`${s.eb}/settlement`)).data;
    const code = (name: string) => payments.find((p: { memberName: string }) => p.memberName === name).paymentCode as string;
    const { resolveKey } = await testKey();
    const deliver = async (f: ReceiptFields) => handleEmail(env, (await venmoEmail(f)).raw, { resolveKey });
    calls = [];

    await deliver({ amount: "20.00", note: code("Alice"), txnId: "N1" });
    await deliver({ amount: "40.00", note: code("Bob"), txnId: "N2" });
    await deliver({ amount: "9.00", note: code("Alice").replace(/m\d+$/, "m099"), txnId: "N3" });
    await deliver({ amount: "9.00", note: "lunch", txnId: "N4" });
    const texts = sent();
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("Alice 付了 $20.00");
    expect(texts[0]).toContain("还差 $36.00");
    expect(texts[1]).toContain("Bob 多付了 $9.00");
    expect(texts[2]).toContain("需要确认");
    expect(texts[2]).toContain("编号里的成员没有这次活动的应付款");
  });
});

describe("admin link from Telegram", () => {
  it("answers 管理页面 from the bound chat only, with the working link", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    await webhook("管理页面", 99); // someone else
    expect(sent()).toEqual([]);

    await webhook("管理页面", 42);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain(`https://jaysbadminton.llmat.dev/admin/${ctx.adminToken}`);
    await webhook("/admin", 42);
    expect(sent()[1]).toContain(ctx.adminToken);
  });

  it("issues a new link when the stored one cannot be recovered", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'admin_token_enc'").run();
    await webhook("管理页面", 42);
    const link = /admin\/([A-Za-z0-9_-]+)/.exec(sent()[0]!)![1]!;
    expect(link).not.toBe(ctx.adminToken);
    expect(sent()[0]).toContain("旧链接已失效");
    expect((await ctx.admin.call(`${ctx.base}/members`)).status).toBe(404);
    expect((await ctx.admin.call(`/api/admin/${link}/members`)).status).toBe(200);
  });
});

describe("Gmail forwarding confirmation", () => {
  const confirmation = (sign = true) =>
    venmoEmail(
      { from: "Gmail Team <forwarding-noreply@google.com>", txnId: "G1" },
      {
        sign,
        domain: "google.com",
        subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from owner@example.com",
        body: "<p>owner@example.com has requested to automatically forward mail.</p><p>Confirmation code: 123456789</p><p>https://mail-settings.google.com/mail/vf-abc</p>",
      },
    );

  it("passes a genuine confirmation to the Owner's Telegram and records it", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const { resolveKey } = await testKey();
    const outcome = await handleEmail(env, (await confirmation()).raw, { resolveKey });
    expect(outcome).toBe("gmail_confirm");
    expect(sent()[0]).toContain("Confirmation code: 123456789");
    expect(sent()[0]).toContain("https://mail-settings.google.com/mail/vf-abc");

    await recordEmailOutcome(env, outcome);
    expect((await ctx.admin.call(`${ctx.base}/email-status`)).data).toMatchObject({ outcome: "收到 Gmail 转发确认邮件，已发到你的 Telegram" });
  });

  it("ignores an unsigned one", async () => {
    await setUpAdmin();
    await connectChat();
    const { resolveKey } = await testKey();
    expect(await handleEmail(env, (await confirmation(false)).raw, { resolveKey })).toBe("gmail_unverified");
    expect(sent()).toEqual([]);
  });
});

describe("forwarding status", () => {
  it("shows the last Venmo email's outcome and skips non-Venmo noise", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/email-status`)).data).toEqual({ lastAt: null, outcome: null });
    await recordEmailOutcome(env, "not_venmo");
    expect((await ctx.admin.call(`${ctx.base}/email-status`)).data.lastAt).toBeNull();
    await recordEmailOutcome(env, "ignored");
    const s = (await ctx.admin.call(`${ctx.base}/email-status`)).data;
    expect(s.lastAt).not.toBeNull();
    expect(s.outcome).toContain("转发工作正常");
  });
});

describe("health alerts", () => {
  /** The next Monday (Pacific) on or after a date, so the digest test does not depend on today. */
  function nextMonday(from: string): string {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
    return d.toISOString().slice(0, 10);
  }

  it("alerts once a day about a Venmo email it could not use", async () => {
    await setUpAdmin();
    await connectChat();
    const at = pacific(futureDate(0), "12:00");
    await emailProblemAlert(env, "parse_failed", at);
    await emailProblemAlert(env, "parse_failed", new Date(at.getTime() + 3600_000));
    await emailProblemAlert(env, "wrong_recipient", at);
    await emailProblemAlert(env, "paid", at);
    await emailProblemAlert(env, "ignored", at);
    expect(sent()).toHaveLength(2);
    expect(sent()[0]).toContain("读不懂");
    expect(sent()[1]).toContain("收款设置");
  });

  it("warns when bills are out but no Venmo email has come for days, once per quiet spell", async () => {
    const s = await billingScenario();
    await connectChat();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('weekly_digest', '0')").run();
    const day = futureDate(0);
    calls = [];

    // Bills only just went out: nothing yet.
    await runScheduled(env, pacific(day, "10:05"));
    expect(sent().filter((t) => t.includes("📭"))).toEqual([]);

    // Four days on, still no email at all, at the bill-reminder hour only.
    await env.DB.prepare("UPDATE events SET finalized_at = '2000-01-01T00:00:00.000Z'").run();
    await runScheduled(env, pacific(day, "14:05"));
    expect(sent().filter((t) => t.includes("📭"))).toEqual([]);
    await runScheduled(env, pacific(day, "10:15"));
    await runScheduled(env, pacific(futureDate(1), "10:05"));
    const quiet = sent().filter((t) => t.includes("📭"));
    expect(quiet).toHaveLength(1);
    expect(quiet[0]).toContain("还没收到过任何 Venmo 邮件");
    expect(quiet[0]).toContain("2 笔账单没付清");

    // An email arrives: forwarding works, no alert while it is recent.
    calls = [];
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_last_at', ?)").bind(pacific(day, "09:00").toISOString()).run();
    await runScheduled(env, pacific(futureDate(2), "10:05"));
    expect(sent().filter((t) => t.includes("📭"))).toEqual([]);
  });

  it("sends a weekly digest on Monday at the bill-reminder hour", async () => {
    const s = await billingScenario();
    await connectChat();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const monday = nextMonday(futureDate(0));
    const at = pacific(monday, "10:05");
    const recent = new Date(at.getTime() - 2 * 24 * 3600_000).toISOString();
    await env.DB.prepare("DELETE FROM email_log").run();
    await env.DB.prepare("INSERT INTO email_log (received_at, outcome) VALUES (?, 'paid'), (?, 'paid'), (?, 'review'), (?, 'ignored'), ('2000-01-01T00:00:00.000Z', 'paid')")
      .bind(recent, recent, recent, recent)
      .run();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('email_last_at', ?)").bind(recent).run();

    const text = await digestText(env, at);
    expect(text).toContain("📊 每周简报");
    expect(text).toContain("Venmo 邮件：收到 4 封（自动记账 2，待确认 1，无关收款（已忽略） 1）");
    expect(text).toContain("未付清账单：2 笔，共 $87.00");
    expect(text).toContain("✓ 邮件转发");
    expect(text).toContain("✓ 定时任务：正常");
    expect(text).toContain("Google 表格同步：没有开启");
    // Old rows are pruned.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM email_log").first("n")).toBe(4);

    calls = [];
    await runScheduled(env, pacific(monday, "09:05"));
    await runScheduled(env, at);
    await runScheduled(env, new Date(at.getTime() + 600_000));
    expect(sent().filter((t) => t.includes("📊"))).toHaveLength(1);

    // It can be switched off.
    await s.admin.call(`${s.base}/settings`, { weeklyDigest: false });
    expect((await s.admin.call(`${s.base}/settings`)).data.weeklyDigest).toBe(false);
  });

  it("logs every Venmo email outcome for the digest, but not spam", async () => {
    await env.DB.prepare("DELETE FROM email_log").run();
    await recordEmailOutcome(env, "not_venmo");
    await recordEmailOutcome(env, "paid");
    await recordEmailOutcome(env, "parse_failed");
    const { results } = await env.DB.prepare("SELECT outcome FROM email_log ORDER BY id").all<{ outcome: string }>();
    expect(results.map((r) => r.outcome)).toEqual(["paid", "parse_failed"]);
  });
});
