import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  appoint,
  approveMember,
  Client,
  createTestEvent,
  expire,
  futureDate,
  GOOGLE,
  request,
  setUpAdmin,
} from "./helpers";

/** 恢复活动 (Ke Li 2026-11-17): a cancelled event can be brought back. */

const anon = new Client();
const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });

const status = async (id: number) =>
  (await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(id).first<{ status: string }>())!.status;

describe("恢复活动", () => {
  it("brings a cancelled event back with its roster, open while the deadline is ahead", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const eb = `${ctx.base}/events/${e.id}`;
    const gus = await approveMember(ctx, "Gus");
    await anon.call(`${gus.base}/events/${e.id}/signup`, { friends: ["Tom"] });

    expect((await ctx.admin.call(eb)).data.restorable).toBe(false);
    const early = await ctx.admin.call(`${eb}/restore`, {});
    expect(early.data.error.message).toBe("只能恢复已取消的活动");

    await ctx.admin.call(`${eb}/cancel`, {});
    expect((await ctx.admin.call(eb)).data).toMatchObject({ status: "cancelled", restorable: true });

    const back = await ctx.admin.call(`${eb}/restore`, {});
    expect(back.status).toBe(200);
    expect(back.data).toMatchObject({ status: "open", headcount: 2, restorable: false });
    // Gus can still change his sign-up.
    expect((await anon.call(`${gus.base}/events/${e.id}/signup`, { friends: [] })).status).toBe(200);

    const again = await ctx.admin.call(`${eb}/restore`, {});
    expect(again.data.error.message).toBe("只能恢复已取消的活动");
    const { results } = await env.DB.prepare(
      "SELECT action, detail FROM event_audit WHERE event_id = ? AND action = 'restore'",
    )
      .bind(e.id)
      .all();
    expect(results).toEqual([{ action: "restore", detail: "恢复活动，继续报名" }]);
  });

  it("comes back closed once its deadline has passed, and not past its 结算期限", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const eb = `${ctx.base}/events/${e.id}`;
    await expire(e.id);
    await ctx.admin.call(`${eb}/cancel`, {});
    expect((await ctx.admin.call(`${eb}/restore`, {})).data.status).toBe("closed");

    // Ended 49 hours ago (the default 结算期限 is 48): the cron would archive it again at once.
    await ctx.admin.call(`${eb}/cancel`, {});
    await env.DB.prepare("UPDATE events SET start_at = ?, end_at = ?, created_at = '2026-01-01T00:00:00Z' WHERE id = ?")
      .bind(
        new Date(Date.now() - 51 * 3600_000).toISOString(),
        new Date(Date.now() - 49 * 3600_000).toISOString(),
        e.id,
      )
      .run();
    expect((await ctx.admin.call(eb)).data.restorable).toBe(false);
    const late = await ctx.admin.call(`${eb}/restore`, {});
    expect(late.data.error.message).toBe("活动结束已超过结算期限，不能再恢复");
    expect(await status(e.id)).toBe("cancelled");

    // A 无需收款 one has no 结算期限.
    await env.DB.prepare("UPDATE events SET no_fee = 1 WHERE id = ?").bind(e.id).run();
    expect((await ctx.admin.call(`${eb}/restore`, {})).data.status).toBe("closed");
  });

  it("lets an organizer restore their own event, an admin anyone's", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const org = await appoint(alice.id, "alice");
    const adm = await appoint(bob.id, "bob", "admin");
    expect(
      (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" }))
        .status,
    ).toBe(200);
    const theirs = await createTestEvent(ctx);
    const mine = await json(
      await request(`${GOOGLE}/events`, org, {
        date: futureDate(8),
        startTime: "18:30",
        endTime: "20:30",
        location: "Alice Gym",
        deadlineDays: 2,
        deadlineHours: 0,
      }),
    );
    await ctx.admin.call(`${ctx.base}/events/${theirs.id}/cancel`, {});
    await ctx.admin.call(`${ctx.base}/events/${mine.data.id}/cancel`, {});

    expect((await request(`${GOOGLE}/events/${theirs.id}/restore`, org, {})).status).toBe(403);
    expect((await json(await request(`${GOOGLE}/events/${mine.data.id}/restore`, org, {}))).data.status).toBe("open");
    expect((await json(await request(`${GOOGLE}/events/${theirs.id}/restore`, adm, {}))).data.status).toBe("open");
  });

  it("hands an event back to the Owner when its organizer was revoked while it was cancelled", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const org = await appoint(alice.id, "alice");
    await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" });
    const mine = await json(
      await request(`${GOOGLE}/events`, org, {
        date: futureDate(8),
        startTime: "18:30",
        endTime: "20:30",
        location: "Alice Gym",
        deadlineDays: 2,
        deadlineHours: 0,
      }),
    );
    await ctx.admin.call(`${ctx.base}/events/${mine.data.id}/cancel`, {});
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(alice.id).run();
    const back = await ctx.admin.call(`${ctx.base}/events/${mine.data.id}/restore`, {});
    expect(back.data.manager.name).toBe("Jay");
    expect(back.data.payee.name).toBe("Jay");
  });
});
