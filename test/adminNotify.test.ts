import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendApplicationNotice } from "../src/worker/approvalEmail";
import type { EventRow } from "../src/worker/events";
import type { MemberRow } from "../src/worker/members";
import { notifyFinalized } from "../src/worker/notify";
import { appoint, approveMember, createTestEvent, futureDate, GOOGLE, ORIGIN, request, setUpAdmin } from "./helpers";

/** 管理员 PR 4: who hears about new applications, admins' events and transfers. */

const on = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const off = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "0" };

let calls: { chat: string; text: string }[] = [];
let refuse = new Set<string>();
beforeEach(() => {
  calls = [];
  refuse = new Set();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/sendMessage")) calls.push({ chat: String(body.chat_id), text: body.text });
    const ok = !refuse.has(String(body.chat_id));
    return Response.json(ok ? { ok: true, result: { message_id: 1 } } : { ok: false, description: "blocked" });
  });
});
afterEach(() => vi.restoreAllMocks());

const OWNER_CHAT = "42";
const CAROL_CHAT = "77";
const DAVE_CHAT = "88";
const to = (chat: string) => calls.filter((c) => c.chat === chat).map((c) => c.text);
const connect = (id: string, chat: string) =>
  env.DB.prepare("INSERT INTO telegram_bindings (member_id, chat_id, chat_name) VALUES (?, ?, 'TG')")
    .bind(id, chat)
    .run();
const connectOwner = () =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?)").bind(OWNER_CHAT).run();
const memberRow = (id: string) => env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<MemberRow>();
const eventRow = (id: number) => env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();

/** Owner Jay, admins Carol and Dave, organizer Alice, and Bob, who has just applied. */
async function scenario() {
  const ctx = await setUpAdmin();
  const carol = await approveMember(ctx, "Carol");
  const dave = await approveMember(ctx, "Dave");
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  await env.DB.prepare("UPDATE members SET status = 'pending' WHERE id = ?").bind(bob.id).run();
  const admin = await appoint(carol.id, "carol", "admin");
  await appoint(dave.id, "dave", "admin");
  const org = await appoint(alice.id, "alice");
  calls = [];
  return { ctx, carol, dave, alice, bob, admin, org };
}

describe("新成员申请", () => {
  it("goes to the Owner and every admin with Telegram, never to organizers", async () => {
    const { carol, dave, alice, bob } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    await connect(dave.id, DAVE_CHAT);
    await connect(alice.id, "99");
    expect(await sendApplicationNotice(on, (await memberRow(bob.id))!)).toBe(true);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(CAROL_CHAT)[0]).toContain("新成员申请待审核");
    expect(to(CAROL_CHAT)[0]).toContain(`管理页（用 Google 登录）：${ORIGIN}/admin/google`);
    expect(to(DAVE_CHAT)).toHaveLength(1);
    expect(to("99")).toEqual([]);
  });

  it("counts as sent when only an admin got it, and skips admins while the flag is off", async () => {
    const { carol, bob } = await scenario();
    await connect(carol.id, CAROL_CHAT);
    expect(await sendApplicationNotice(on, (await memberRow(bob.id))!)).toBe(true);
    calls = [];
    expect(await sendApplicationNotice(off, (await memberRow(bob.id))!)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("leaves out an admin who was revoked or disabled", async () => {
    const { carol, bob } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(carol.id).run();
    await sendApplicationNotice(on, (await memberRow(bob.id))!);
    expect(to(CAROL_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)).toHaveLength(1);
  });
});

describe("新成员申请, delivery", () => {
  it("is sent once anyone got it, and not when nobody did", async () => {
    const { carol, bob } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    refuse.add(OWNER_CHAT);
    expect(await sendApplicationNotice(on, (await memberRow(bob.id))!)).toBe(true);
    refuse.add(CAROL_CHAT);
    expect(await sendApplicationNotice(on, (await memberRow(bob.id))!)).toBe(false);
  });

  it("goes to the Owner alone while the flag is off", async () => {
    const { carol, bob } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    expect(await sendApplicationNotice(off, (await memberRow(bob.id))!)).toBe(true);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(CAROL_CHAT)).toEqual([]);
  });
});

describe("an admin's event", () => {
  it("falls back to the Owner, naming the admin, when they have no Telegram", async () => {
    const { ctx, carol } = await scenario();
    await connectOwner();
    const mine = await createTestEvent(ctx, { date: futureDate(10) });
    await env.DB.prepare("UPDATE events SET manager_id = ?1, payee_id = ?1 WHERE id = ?2")
      .bind(carol.id, mine.id)
      .run();
    await notifyFinalized(on, (await eventRow(mine.id))!);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("管理员 Carol 还没连接 Telegram，这条发给群主");
  });

  it("names them as 管理员 in the Owner's copies", async () => {
    const { carol, admin } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    const res = await request(
      `${GOOGLE}/events`,
      admin,
      {
        date: futureDate(9),
        startTime: "18:30",
        endTime: "20:30",
        location: "Carol Gym",
        deadlineDays: 1,
        deadlineHours: 0,
      },
      "1",
    );
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { id: number }).id;
    expect(to(OWNER_CHAT)[0]).toMatch(/^🆕 管理员 Carol 发起了新活动：/);
    calls = [];
    await notifyFinalized(on, (await eventRow(id))!);
    expect(to(CAROL_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^📋 抄送：管理员 Carol 负责的活动\n/);
  });

  it("says nothing about one created after it started (for testing)", async () => {
    const { admin } = await scenario();
    await connectOwner();
    const res = await request(
      `${GOOGLE}/events`,
      admin,
      {
        date: futureDate(-2),
        startTime: "18:30",
        endTime: "20:30",
        location: "Carol Gym",
        deadlineDays: 0,
        deadlineHours: 0,
      },
      "1",
    );
    expect(res.status).toBe(200);
    expect(to(OWNER_CHAT)).toEqual([]);
  });
});

describe("转交", () => {
  it("tells whoever was paid when someone else hands their event on before Finalize", async () => {
    const { ctx, alice, carol, admin } = await scenario();
    await connectOwner();
    await connect(alice.id, "99");
    const mine = await createTestEvent(ctx, { date: futureDate(10) });
    // An admin hands the Owner's event to Alice: the Owner is told.
    expect((await request(`${GOOGLE}/events/${mine.id}/transfer`, admin, { to: alice.id }, "1")).status).toBe(200);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toMatch(/^🔁 Carol 把活动 .+ 转交给了 Alice。\n成员的钱以后付给 Alice，不再付给你。/);
    // The Owner hands it on to Carol: Alice is told, and nobody tells the Owner what they just did.
    calls = [];
    expect(
      (await request(`${ctx.base}/events/${mine.id}/transfer`, ctx.admin.cookie, { to: carol.id }, "1")).status,
    ).toBe(200);
    expect(to("99")[0]).toMatch(/^🔁 Jay 把活动 .+ 转交给了 Carol。/);
    expect(to(OWNER_CHAT)).toEqual([]);
  });

  it("says nothing when the money stays put (after Finalize) or the payee did it", async () => {
    const { ctx, alice, carol, admin } = await scenario();
    await connectOwner();
    await connect(carol.id, CAROL_CHAT);
    const mine = await createTestEvent(ctx, { date: futureDate(10) });
    await env.DB.prepare("UPDATE events SET status = 'finalized' WHERE id = ?").bind(mine.id).run();
    expect((await request(`${GOOGLE}/events/${mine.id}/transfer`, admin, { to: alice.id }, "1")).status).toBe(200);
    expect(calls).toEqual([]);

    const other = await createTestEvent(ctx, { date: futureDate(11) });
    await request(`${ctx.base}/events/${other.id}/transfer`, ctx.admin.cookie, { to: carol.id }, "1");
    calls = [];
    // Carol, now paid for it, hands it on herself.
    expect((await request(`${GOOGLE}/events/${other.id}/transfer`, admin, { to: alice.id }, "1")).status).toBe(200);
    expect(to(CAROL_CHAT)).toEqual([]);
  });
});
