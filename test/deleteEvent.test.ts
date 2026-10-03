import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { billingScenario as scenario, createTestEvent, futureDate, setUpAdmin } from "./helpers";

const count = async (sql: string, ...args: unknown[]) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`)
    .bind(...args)
    .first<{ n: number }>())!.n;

describe("从数据库永久删除", () => {
  it("removes an archived event with its roster, bills, receipts and matched Venmo payments", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const { payments } = (await s.admin.call(`${s.eb}/settlement`)).data;
    const alice = payments.find((p: { memberName: string }) => p.memberName === "Alice");
    // A Venmo payment the Owner linked from 待确认, then everyone else pays by hand.
    const inbound = await env.DB.prepare(
      `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, received_at, kind) VALUES ('T9', 'Alice', ?, ?, 'unmatched') RETURNING id`,
    )
      .bind(alice.amountDueCents, new Date().toISOString())
      .first<{ id: number }>();
    expect((await s.admin.call(`${s.base}/inbound/${inbound!.id}/link`, { paymentId: alice.id })).status).toBe(200);
    for (const p of payments) if (p.id !== alice.id) await s.admin.call(`${s.base}/payments/${p.id}/mark-paid`, {});
    expect((await s.admin.call(s.eb)).data).toMatchObject({ status: "settled", deletable: true });
    // An unrelated event stays untouched.
    const other = await createTestEvent(s);
    await env.DB.prepare(
      "INSERT INTO notification_log (event_id, type, sent_on, sent_at) VALUES (?, 'reminder', 'x', 'x')",
    )
      .bind(s.e.id)
      .run();

    const wrong = await s.admin.call(`${s.eb}/delete`, { password: "nope" });
    expect(wrong.status).toBe(401);
    expect(await count("events WHERE id = ?", s.e.id)).toBe(1);

    expect((await s.admin.call(`${s.eb}/delete`, { password: "initial-password" })).status).toBe(200);
    expect((await s.admin.call(s.eb)).status).toBe(404);
    expect(await count("registrations WHERE event_id = ?", s.e.id)).toBe(0);
    expect(await count("payments WHERE event_id = ?", s.e.id)).toBe(0);
    expect(await count("settlements WHERE event_id = ?", s.e.id)).toBe(0);
    expect(await count("notification_log WHERE event_id = ?", s.e.id)).toBe(0);
    expect(await count("payment_receipts")).toBe(0);
    expect(await count("inbound_payments")).toBe(0);
    expect(await count("events WHERE id = ?", other.id)).toBe(1);
    expect((await s.admin.call(`${s.base}/events`)).data.past).toEqual([]);
    const stub = env.DEADLINES.get(env.DEADLINES.idFromName(String(s.e.id)));
    expect(await runInDurableObject(stub, (_o, state) => state.storage.get("eventId"))).toBeUndefined();
  });

  it("deletes a cancelled event but not one that is still coming up", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.deletable).toBe(false);
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/delete`, { password: "initial-password" });
    expect(res.data.error.message).toBe("只能删除已收齐归档或已取消的活动");

    await ctx.admin.call(`${ctx.base}/events/${e.id}/cancel`, {});
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/delete`, { password: "initial-password" })).status).toBe(
      200,
    );
    expect(await count("events")).toBe(0);
  });

  it("refuses an event that still has unpaid bills, even once it is over", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await env.DB.prepare("UPDATE events SET end_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), s.e.id)
      .run();
    expect((await s.admin.call(s.eb)).data).toMatchObject({ status: "finalized", deletable: false });
    const res = await s.admin.call(`${s.eb}/delete`, { password: "initial-password" });
    expect(res.data.error.message).toBe("只能删除已收齐归档或已取消的活动");
    expect(await count("payments WHERE event_id = ?", s.e.id)).toBeGreaterThan(0);
  });

  it("never gives a deleted event's code to a new event", async () => {
    const ctx = await setUpAdmin();
    const first = await createTestEvent(ctx, { date: futureDate(20) }); // a day no other test uses
    await ctx.admin.call(`${ctx.base}/events/${first.id}/cancel`, {});
    await ctx.admin.call(`${ctx.base}/events/${first.id}/delete`, { password: "initial-password" });
    const second = await createTestEvent(ctx, { date: first.date });
    expect(second.code).toBe(`${first.code}B`);
  });
});
