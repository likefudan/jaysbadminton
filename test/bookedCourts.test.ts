import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deadlineNotices, nextDeadlineAlarm } from "../src/worker/notify";
import { drainPushes } from "../src/worker/push";
import { Client, approveMember, createTestEvent, expire, setUpAdmin } from "./helpers";

let pushTries = 0;

beforeEach(() => {
  pushTries = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.telegram.org/")) return Response.json({ ok: true, result: { message_id: 1 } });
    // The push service is down, so what was queued stays in push_outbox to be read.
    if (url.startsWith("https://fcm.googleapis.com/")) {
      pushTries++;
      return new Response("", { status: 503 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A browser with push on for this member (real keys, so the payload can be encrypted). */
async function pushOn(memberId: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  await env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      `https://fcm.googleapis.com/fcm/send/${memberId}`,
      memberId,
      b64(pub),
      b64(crypto.getRandomValues(new Uint8Array(16))),
      new Date().toISOString(),
    )
    .run();
}

const startPushes = async () =>
  (
    await env.DB.prepare("SELECT member_id, payload FROM push_outbox WHERE kind = 'start' ORDER BY member_id").all<{
      member_id: string;
      payload: string;
    }>()
  ).results.map((r) => ({ member: r.member_id, ...JSON.parse(r.payload) }));

async function scene() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const e = await createTestEvent(ctx);
  const member = new Client();
  expect((await member.call(`${alice.base}/events/${e.id}/signup`, { friends: [] })).status).toBe(200);
  return { ctx, alice, bob, e, member };
}

const myEvent = async (base: string, id: number) =>
  ((await new Client().call(`${base}/events`)).data.events as { id: number; courts: number[] }[]).find(
    (x) => x.id === id,
  );

describe("预定场地", () => {
  it("is set from the admin page, cleaned up, and shown to the players on the event", async () => {
    const { ctx, alice, bob, e } = await scene();
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [12, 3, 3, 5] });
    expect(res.status).toBe(200);
    expect(res.data.courts).toEqual([3, 5, 12]);
    expect((await myEvent(alice.base, e.id))!.courts).toEqual([3, 5, 12]);
    // Bob isn't on it: the event is offered to him (open), without its courts.
    expect((await myEvent(bob.base, e.id))!.courts).toEqual([]);

    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [100] })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [0] })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: "3" })).status).toBe(400);

    const log = await ctx.admin.call(`${ctx.base}/events/${e.id}/audit`);
    expect(JSON.stringify(log.data)).toContain("预定场地 （无） → 3、5、12 号");
  });

  it("can still change after sign-up closes, but not once finalized", async () => {
    const { ctx, e } = await scene();
    await expire(e.id);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [7] })).status).toBe(200);
    await env.DB.prepare("UPDATE events SET status = 'finalized' WHERE id = ?").bind(e.id).run();
    const late = await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [8] });
    expect(late.status).toBe(400);
    expect(late.data.error.message).toContain("Finalize");
  });

  it("is refused to a member's link", async () => {
    const { alice, e } = await scene();
    expect((await new Client().call(`${alice.base}/events/${e.id}/courts`, { courts: [3] })).status).toBe(404);
  });
});

describe("开始前 10 分钟的推送", () => {
  it("aims the event's alarm 10 minutes before the start once sign-up is closed and announced", async () => {
    const { e } = await scene();
    const start = Date.parse(
      (await env.DB.prepare("SELECT start_at FROM events WHERE id = ?").bind(e.id).first<{ start_at: string }>())!
        .start_at,
    );
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
    await expire(e.id);
    // 报名截止 hasn't gone out yet: that first.
    expect(await nextDeadlineAlarm(env, e.id)).toBeLessThanOrEqual(Date.now());
    await deadlineNotices(env, e.id);
    expect(await nextDeadlineAlarm(env, e.id)).toBe(start - 10 * 60_000);
  });

  it("still aims at it when 报名截止 couldn't go out (no Telegram), leaving that to the cron", async () => {
    const { e } = await scene();
    const start = Date.parse(
      (await env.DB.prepare("SELECT start_at FROM events WHERE id = ?").bind(e.id).first<{ start_at: string }>())!
        .start_at,
    );
    await expire(e.id);
    const stub = env.DEADLINES.get(env.DEADLINES.idFromName(String(e.id)));
    await stub.sync(e.id);
    await runDurableObjectAlarm(stub); // false when the alarm is already firing by itself
    await vi.waitFor(async () =>
      expect(await runInDurableObject(stub, (_o, state) => state.storage.getAlarm())).toBe(start - 10 * 60_000),
    );
  });

  it("goes to everyone on the event with the courts, once", async () => {
    const { ctx, alice, bob, e } = await scene();
    await pushOn(alice.id);
    await pushOn(bob.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/courts`, { courts: [3, 5] });
    await expire(e.id);
    const row = (await env.DB.prepare("SELECT start_at FROM events WHERE id = ?")
      .bind(e.id)
      .first<{ start_at: string }>())!;
    const at = new Date(Date.parse(row.start_at) - 5 * 60_000);
    await deadlineNotices(env, e.id, at);
    await deadlineNotices(env, e.id, at);
    const sent = await startPushes();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ member: alice.id, title: "羽毛球 10 分钟后开始", url: `/e/${e.code}` });
    expect(sent[0].body).toContain("19:00–21:00 Bay Badminton Center");
    expect(sent[0].body).toContain("场地：3、5 号");
    // Nothing more to do for it.
    expect(await nextDeadlineAlarm(env, e.id, at)).toBeNull();
  });

  it("goes out without a courts line when none were set, and not before its time", async () => {
    const { alice, e } = await scene();
    await pushOn(alice.id);
    const row = (await env.DB.prepare("SELECT start_at FROM events WHERE id = ?")
      .bind(e.id)
      .first<{ start_at: string }>())!;
    const start = Date.parse(row.start_at);
    await deadlineNotices(env, e.id, new Date(start - 11 * 60_000));
    expect(await startPushes()).toEqual([]);
    await deadlineNotices(env, e.id, new Date(start - 10 * 60_000));
    const [p] = await startPushes();
    expect(p.body).not.toContain("场地");
  });

  it("isn't sent to someone who dropped out after it was queued", async () => {
    const { alice, e, member } = await scene();
    await pushOn(alice.id);
    // As pushStarting queues it (sent here by hand, so no PushSender run races the test).
    await env.DB.prepare(
      `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
       SELECT endpoint, member_id, 'start', ?, '{"title":"t","body":"b","url":"/","tag":"t"}', ? FROM push_subscriptions`,
    )
      .bind(e.id, new Date().toISOString())
      .run();
    expect((await member.call(`${alice.base}/events/${e.id}/cancel`, {})).status).toBe(200);
    await drainPushes(env);
    expect(pushTries).toBe(0);
    expect(await startPushes()).toEqual([]);
  });
});
