import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endDueNoFeeEvents } from "../src/worker/noFee";
import { runScheduled } from "../src/worker/notify";
import { Client, approveMember, createTestEvent, expire, setUpAdmin } from "./helpers";

let telegram: string[] = [];

beforeEach(() => {
  telegram = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.telegram.org/")) {
      telegram.push(String(init?.body ?? ""));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    if (url.startsWith("https://fcm.googleapis.com/")) return new Response("", { status: 503 });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

/** Alice signed up for a 无需收款 event. */
async function scene(overrides: Record<string, unknown> = {}) {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const e = await createTestEvent(ctx, { noFee: true, ...overrides });
  expect((await new Client().call(`${alice.base}/events/${e.id}/signup`, { friends: [] })).status).toBe(200);
  return { ctx, alice, e };
}

const status = async (id: number) =>
  (await env.DB.prepare("SELECT status, finalized_at, settled_at FROM events WHERE id = ?").bind(id).first<{
    status: string;
    finalized_at: string | null;
    settled_at: string | null;
  }>())!;

/** Moves the event so that it ended `minutes` ago. */
const endedAgo = (id: number, minutes: number) =>
  env.DB.prepare("UPDATE events SET start_at = ?, end_at = ?, deadline_at = ?, status = 'closed' WHERE id = ?")
    .bind(
      new Date(Date.now() - (minutes + 120) * 60_000).toISOString(),
      new Date(Date.now() - minutes * 60_000).toISOString(),
      new Date(Date.now() - (minutes + 180) * 60_000).toISOString(),
      id,
    )
    .run();

describe("无需收款", () => {
  it("is set when creating, shown on the event, and remembered with the venue", async () => {
    const { ctx, alice, e } = await scene();
    expect(e.noFee).toBe(true);
    const mine = await new Client().call(`${alice.base}/events`);
    expect(mine.data.events.find((x: { id: number }) => x.id === e.id).noFee).toBe(true);
    const defaults = await ctx.admin.call(`${ctx.base}/events/defaults`);
    expect(defaults.data.locations).toEqual([
      expect.objectContaining({ name: "Bay Badminton Center", noFee: true, queueRoundMin: null }),
    ]);
    // A normal event at the same venue turns it off again for next time.
    const plain = await createTestEvent(ctx);
    expect(plain.noFee).toBe(false);
    expect((await ctx.admin.call(`${ctx.base}/events/defaults`)).data.locations[0].noFee).toBe(false);
  });

  it("has no Finalize", async () => {
    const { ctx, e } = await scene();
    await expire(e.id);
    const body = { courtTotal: "60", shuttleCount: 2, shuttlePrice: "3" };
    for (const path of ["preview", "finalize"]) {
      const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/${path}`, body);
      expect(res.status).toBe(400);
      expect(res.data.error.message).toContain("无需收款");
    }
  });

  it("ends by hand straight into history, with nothing to collect", async () => {
    const { ctx, alice, e } = await scene();
    await expire(e.id);
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/end`, {});
    expect(res.status).toBe(200);
    const s = await status(e.id);
    expect(s.status).toBe("settled");
    expect(s.finalized_at).toBeNull();
    expect(s.settled_at).not.toBeNull();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE event_id = ?").bind(e.id).first<{
      n: number;
    }>();
    expect(n!.n).toBe(0);
    // Ended before it was over: on 我的活动 it's settled, not owing.
    const mine = await new Client().call(`${alice.base}/events`);
    expect(mine.data.events.find((x: { id: number }) => x.id === e.id).status).toBe("settled");
    const log = await ctx.admin.call(`${ctx.base}/events/${e.id}/audit`);
    expect(JSON.stringify(log.data)).toContain("结束活动（无需收款）");
    // Only once, and not on a normal event.
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/end`, {})).status).toBe(400);
    const plain = await createTestEvent(ctx);
    expect((await ctx.admin.call(`${ctx.base}/events/${plain.id}/end`, {})).status).toBe(400);
  });

  it("is refused to a member's link", async () => {
    const { alice, e } = await scene();
    expect((await new Client().call(`${alice.base}/events/${e.id}/end`, {})).status).toBe(404);
  });

  it("ends by itself an hour after its end time and shows in history", async () => {
    const { ctx, alice, e } = await scene();
    const plain = await createTestEvent(ctx);
    await endedAgo(e.id, 50);
    await endedAgo(plain.id, 120);
    await endDueNoFeeEvents(env);
    expect((await status(e.id)).status).toBe("closed");
    await endedAgo(e.id, 61);
    await endDueNoFeeEvents(env);
    expect((await status(e.id)).status).toBe("settled");
    expect((await status(plain.id)).status).toBe("closed"); // waits for Finalize as before
    const mine = await new Client().call(`${alice.base}/events`);
    expect(mine.data.history).toEqual([expect.objectContaining({ id: e.id, noFee: true, amountCents: null })]);
    const log = await ctx.admin.call(`${ctx.base}/events/${e.id}/audit`);
    expect(JSON.stringify(log.data)).toContain("自动结束（无需收款）");
  });

  it("sends no 结算 reminder", async () => {
    const { ctx, e } = await scene();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
    const plain = await createTestEvent(ctx);
    await endedAgo(e.id, 10);
    await endedAgo(plain.id, 10);
    const at = new Date(Date.now() + 86400_000);
    at.setUTCHours(20, 0, 0, 0); // 12:00 or 13:00 Pacific, inside the reminder hours
    await runScheduled(env, at);
    // Only the normal event's: the 无需收款 one has nothing to settle.
    expect(telegram.filter((body) => body.includes("的活动已经结束"))).toHaveLength(1);
  });

  it("can be switched in 修改活动 before Finalize only", async () => {
    const { ctx, e } = await scene();
    const edit = (noFee: boolean) =>
      ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        noFee,
      });
    const off = await edit(false);
    expect(off.status).toBe(200);
    expect(off.data.noFee).toBe(false);
    const log = await ctx.admin.call(`${ctx.base}/events/${e.id}/audit`);
    expect(JSON.stringify(log.data)).toContain("无需收款 开 → 关");
    await env.DB.prepare("UPDATE events SET status = 'finalized' WHERE id = ?").bind(e.id).run();
    expect((await edit(true)).status).toBe(400);
  });
});
