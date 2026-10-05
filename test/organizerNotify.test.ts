import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "../src/worker/events";
import worker from "../src/worker/index";
import { notifyCollected, notifyFinalized, notifyPayment, runScheduled } from "../src/worker/notify";
import { webhookSecret } from "../src/worker/telegram";
import { appoint, approveMember, createTestEvent, futureDate, GOOGLE, ORIGIN, request, setUpAdmin } from "./helpers";

/** Card 7: each person's own Telegram, and every event notice going to whoever runs the event. */

const on = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const off = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "0" };

/** Telegram sendMessage calls: which chat, and the text. */
let calls: { method: string; body: any }[] = [];
let refuse = new Set<string>();

beforeEach(() => {
  calls = [];
  refuse = new Set();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method: url.split("/").pop()!, body });
    const ok = !refuse.has(String(body.chat_id));
    return Response.json(
      ok ? { ok: true, result: { username: "jb_test_bot", message_id: 1 } } : { ok: false, description: "blocked" },
    );
  });
});
afterEach(() => vi.restoreAllMocks());

const OWNER_CHAT = "42";
const ALICE_CHAT = "77";

/** Every message sent, as [chat, text]. */
const sent = () =>
  calls.filter((c) => c.method === "sendMessage").map((c) => [String(c.body.chat_id), c.body.text as string]);
const to = (chat: string) =>
  sent()
    .filter(([c]) => c === chat)
    .map(([, t]) => t!);

const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });

async function hook(text: string, chatId: number) {
  return worker.fetch(
    new Request(`${ORIGIN}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": await webhookSecret(on) },
      body: JSON.stringify({ message: { text, chat: { id: chatId, type: "private", first_name: `chat${chatId}` } } }),
    }),
    on,
    {} as ExecutionContext,
  );
}

const connectOwner = () =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?)").bind(OWNER_CHAT).run();
const connectAlice = (id: string) =>
  env.DB.prepare("INSERT INTO telegram_bindings (member_id, chat_id, chat_name) VALUES (?, ?, 'Alice TG')")
    .bind(id, ALICE_CHAT)
    .run();
const eventRow = (id: number) => env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();

/** The Owner and Alice (an organizer); one event run by each. */
async function scenario() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const org = await appoint(alice.id, "alice");
  const theirs = await createTestEvent(ctx);
  const res = await json(
    await request(`${GOOGLE}/events`, org, {
      date: futureDate(9),
      startTime: "18:30",
      endTime: "20:30",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    }),
  );
  expect(res.status).toBe(200);
  await env.DB.prepare("UPDATE events SET created_at = '2000-01-01T00:00:00.000Z'").run();
  calls = [];
  return { ctx, alice, org, owners: theirs.id as number, alices: res.data.id as number };
}

/** Runs the cron 5 hours before the event's deadline (inside the 6-hour reminder window). */
async function remind(id: number, e = on) {
  const deadline = new Date((await eventRow(id))!.deadline_at).getTime();
  await runScheduled(e, new Date(deadline - 5 * 3600_000));
}

describe("connecting each person's Telegram", () => {
  it("keeps the Owner's and an organizer's codes apart, and binds each to its own chat", async () => {
    const { ctx, org, alice } = await scenario();
    const ownerLink = (await ctx.admin.call(`${ctx.base}/telegram/connect`, {})).data.link as string;
    const aliceLink = (await json(await request(`${GOOGLE}/telegram/connect`, org, {}))).data.link as string;
    expect(aliceLink).toMatch(/^https:\/\/t\.me\/jb_test_bot\?start=/);
    expect(aliceLink).not.toBe(ownerLink);

    // Both codes still work: neither replaced the other.
    await hook(`/start ${aliceLink.split("=")[1]}`, 77);
    await hook(`/start ${ownerLink.split("=")[1]}`, 42);
    expect((await ctx.admin.call(`${ctx.base}/telegram`)).data).toMatchObject({ connected: true, chatName: "chat42" });
    expect((await json(await request(`${GOOGLE}/telegram`, org))).data).toMatchObject({
      connected: true,
      chatName: "chat77",
    });
    expect(
      await env.DB.prepare("SELECT chat_id, bind_hash FROM telegram_bindings WHERE member_id = ?")
        .bind(alice.id)
        .first(),
    ).toEqual({ chat_id: "77", bind_hash: null });
    // Alice's welcome says where her admin pages are: through Google, never the admin link.
    expect(to(ALICE_CHAT)[0]).toContain(`${ORIGIN}/admin/google`);

    // Her code is spent.
    calls = [];
    await hook(`/start ${aliceLink.split("=")[1]}`, 99);
    expect(sent()).toEqual([]);

    // Test message and disconnect are each person's own.
    calls = [];
    expect((await request(`${GOOGLE}/telegram/test`, org, {})).status).toBe(200);
    expect(sent().map(([c]) => c)).toEqual([ALICE_CHAT]);
    expect((await request(`${GOOGLE}/telegram/disconnect`, org, {})).status).toBe(200);
    expect((await json(await request(`${GOOGLE}/telegram`, org))).data.connected).toBe(false);
    expect((await ctx.admin.call(`${ctx.base}/telegram`)).data.connected).toBe(true);
    expect((await request(`${GOOGLE}/telegram/test`, org, {})).status).toBe(400);
  });

  it("ignores strangers, organizers asking for the admin link, and a code made before a revoke", async () => {
    const { org, alice } = await scenario();
    await connectOwner();
    const link = (await json(await request(`${GOOGLE}/telegram/connect`, org, {}))).data.link as string;
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(alice.id).run();
    calls = [];
    await hook(`/start ${link.split("=")[1]}`, 77);
    await hook("hello", 77);
    await hook("管理页面", 77);
    await hook("/admin", 55);
    expect(sent()).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT chat_id FROM telegram_bindings WHERE member_id = ?").bind(alice.id).first())
        ?.chat_id ?? null,
    ).toBeNull();
    // The Owner still gets the link.
    await hook("管理页面", 42);
    expect(to(OWNER_CHAT)[0]).toContain("管理页面");
  });

  it("binds a code once even when /start arrives twice, and answers an organizer's 管理页面 with the Google way in", async () => {
    const { org, alice } = await scenario();
    const link = (await json(await request(`${GOOGLE}/telegram/connect`, org, {}))).data.link as string;
    await Promise.all([hook(`/start ${link.split("=")[1]}`, 77), hook(`/start ${link.split("=")[1]}`, 88)]);
    expect(sent()).toHaveLength(1);
    const row = await env.DB.prepare("SELECT chat_id FROM telegram_bindings WHERE member_id = ?")
      .bind(alice.id)
      .first<{ chat_id: string }>();
    expect(row!.chat_id).toBe(sent()[0]![0]);

    calls = [];
    await hook("管理页面", Number(row!.chat_id));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]![1]).toContain(`${ORIGIN}/admin/google`);
    expect(sent()[0]![1]).not.toContain("群主密码");
  });

  it("moves a Telegram account to the organizer who connects it last", async () => {
    const { ctx, org, alice } = await scenario();
    const bob = await approveMember(ctx, "Bob");
    const bobOrg = await appoint(bob.id, "bob");
    await connectAlice(alice.id);
    const link = (await json(await request(`${GOOGLE}/telegram/connect`, bobOrg, {}))).data.link as string;
    await hook(`/start ${link.split("=")[1]}`, 77);
    expect((await json(await request(`${GOOGLE}/telegram`, bobOrg))).data.connected).toBe(true);
    expect((await json(await request(`${GOOGLE}/telegram`, org))).data.connected).toBe(false);
  });
});

describe("who an event's notices go to", () => {
  it("the Owner's events: the Owner, exactly as before", async () => {
    const { owners, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    await remind(owners);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^⏰/);
    expect(to(OWNER_CHAT)[0]).not.toContain("组织");
  });

  it("a connected organizer's events: the organizer, with 组织 in the WeChat text", async () => {
    const { alices, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    await remind(alices);
    expect(to(OWNER_CHAT)).toEqual([]);
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("羽毛球（组织：Alice）报名还剩 5 小时截止");
  });

  it("an organizer without Telegram: the Owner, saying why", async () => {
    const { alices } = await scenario();
    await connectOwner();
    await remind(alices);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^ℹ️ 组织者 Alice 还没连接 Telegram，这条发给群主。\n⏰/);
  });

  it("an organizer who blocked the bot, or who was revoked, or with the feature off: the Owner", async () => {
    const { alices, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    refuse.add(ALICE_CHAT);
    await remind(alices);
    expect(to(OWNER_CHAT)[0]).toContain("发给组织者 Alice 的 Telegram 没有成功");

    // A revoke would normally hand the event back; this one is left with her to check the fallback.
    await env.DB.prepare("DELETE FROM notification_log").run();
    refuse.clear();
    calls = [];
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(alice.id).run();
    await remind(alices);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)[0]).toContain("这场的负责人 Alice 已经不是组织者");

    await env.DB.prepare("DELETE FROM notification_log").run();
    await env.DB.prepare("UPDATE members SET role = 'organizer' WHERE id = ?").bind(alice.id).run();
    calls = [];
    await remind(alices, off);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)[0]).toContain("这场由 Alice 负责，但组织者功能已关闭");
    // With the feature off the WeChat text is as before.
    expect(to(OWNER_CHAT)[0]).not.toContain("组织：");
  });

  it("sends the daily summary and every bill reminder to the organizer together", async () => {
    const { alices, alice, ctx } = await scenario();
    const bob = await approveMember(ctx, "Bob");
    await connectOwner();
    await connectAlice(alice.id);
    await env.DB.prepare(
      "UPDATE events SET status = 'finalized', finalized_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(alices)
      .run();
    await env.DB.prepare(
      `INSERT INTO payments (event_id, member_id, amount_due_cents, amount_paid_cents, status, payment_code)
       VALUES (?, ?, 1500, 0, 'unpaid', 'code-bob')`,
    )
      .bind(alices, bob.id)
      .run();
    await runScheduled(on, new Date("2026-10-06T17:05:00Z")); // 10:05 Pacific, the default bill-reminder hour
    expect(to(OWNER_CHAT)).toEqual([]);
    expect(to(ALICE_CHAT)).toHaveLength(2);
    expect(to(ALICE_CHAT)[0]).toContain("收款汇总");
    expect(to(ALICE_CHAT)[1]).toContain("账单提醒：Bob");
  });

  it("retries next run when neither the organizer nor the Owner can get it", async () => {
    const { alices } = await scenario();
    await remind(alices);
    expect(sent()).toEqual([]);
    await connectOwner();
    await remind(alices);
    expect(to(OWNER_CHAT)).toHaveLength(1);
  });

  it("copies the Owner on 结算完成 and 收齐 of an organizer's event, once", async () => {
    const { alices, owners, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    await notifyFinalized(on, (await eventRow(alices))!);
    await notifyCollected(on, alices);
    expect(to(ALICE_CHAT)).toHaveLength(2);
    expect(to(ALICE_CHAT)[0]).toContain("羽毛球（组织：Alice）的费用已经出来了");
    expect(to(OWNER_CHAT)).toHaveLength(2);
    expect(to(OWNER_CHAT)[0]).toMatch(/^📋 抄送：组织者 Alice 负责的活动\n✅/);
    expect(to(OWNER_CHAT)[1]).toMatch(/^📋 抄送：组织者 Alice 负责的活动\n🎉/);

    // The Owner's own: one message, no copy.
    calls = [];
    await notifyFinalized(on, (await eventRow(owners))!);
    expect(sent()).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^✅/);
  });

  it("sends an unconnected organizer's 结算完成 to the Owner only once, not again as a copy", async () => {
    const { alices } = await scenario();
    await connectOwner();
    await notifyFinalized(on, (await eventRow(alices))!);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("还没连接 Telegram");
  });

  it("gives an organizer the Google way into the admin pages, not the admin link", async () => {
    const { alices, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    await env.DB.prepare("UPDATE events SET status = 'closed', end_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(alices)
      .run();
    await runScheduled(on, new Date("2026-10-06T20:00:00Z")); // 13:00 Pacific
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("没有人报名，不用结算");
    expect(to(ALICE_CHAT)[0]).toContain(`管理页（用 Google 登录）：${ORIGIN}/admin/google`);
  });

  it("tells the Owner when an organizer creates an event, but not about the Owner's own", async () => {
    const { ctx, org } = await scenario();
    await connectOwner();
    await createTestEvent(ctx, { date: futureDate(10) });
    expect(sent()).toEqual([]);
    await request(`${GOOGLE}/events`, org, {
      date: futureDate(11),
      startTime: "18:30",
      endTime: "20:30",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^🆕 组织者 Alice 发起了新活动：/);
    expect(to(OWNER_CHAT)[0]).toContain("地点：Alice Gym");
  });

  it("sends partial and over-payments to the event's manager, 待确认 to the Owner", async () => {
    const { alices, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    const bill = await env.DB.prepare(
      `INSERT INTO payments (event_id, member_id, amount_due_cents, amount_paid_cents, status, payment_code)
       VALUES (?, ?, 2000, 3000, 'paid', 'test-code') RETURNING id`,
    )
      .bind(alices, alice.id)
      .first<{ id: number }>();
    await notifyPayment(on, "overpaid", { payer: "Alice", amountCents: 3000, note: "x", paymentId: bill!.id });
    await notifyPayment(on, "review", { payer: "Zed", amountCents: 100, note: "y", reason: "?" });
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("多付了 $10.00");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("需要确认");
  });

  it("tells both the Owner and the organizer when the organizer's payment settings change", async () => {
    const { org, alice } = await scenario();
    await connectOwner();
    await connectAlice(alice.id);
    expect(
      (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "a@venmo.test" }))
        .status,
    ).toBe(200);
    expect(to(OWNER_CHAT)[0]).toContain("组织者 Alice 的收款设置已修改");
    expect(to(ALICE_CHAT)[0]).toContain("你的收款设置已修改");
  });
});
