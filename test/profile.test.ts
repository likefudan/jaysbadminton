import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
import { Client, approveMember, createTestEvent, futureDate, setUpAdmin } from "./helpers";

const anon = new Client();
const daysAgo = (n: number) => toPacific(new Date(Date.now() - n * 86400_000)).date;
const past = (id: number, date: string) =>
  env.DB.prepare("UPDATE events SET status = 'settled', date = ?, start_at = ?, end_at = ? WHERE id = ?")
    .bind(date, `${date}T02:00:00.000Z`, `${date}T04:00:00.000Z`, id)
    .run();

describe("个人信息", () => {
  it("shows the basics and one map entry per own signup: done, absent or upcoming", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const events = [];
    for (let i = 0; i < 5; i++) events.push(await createTestEvent(ctx, { date: futureDate(7 + i) }));
    for (const [i, e] of events.entries()) await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: i === 0 ? ["Tom"] : [] });
    await past(events[0].id, daysAgo(10)); // came (friends don't add entries)
    await past(events[1].id, daysAgo(3)); // marked absent
    await env.DB.prepare("UPDATE registrations SET attended = 0 WHERE event_id = ?").bind(events[1].id).run();
    await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(events[3].id).run();
    await past(events[4].id, daysAgo(400)); // older than the map

    const { status, data } = await anon.call(`${alice.base}/profile`);
    expect(status).toBe(200);
    expect(data).toMatchObject({ id: alice.id, username: "Alice", wechatNickname: "Alice", email: null, emailFromGoogle: false });
    expect(Date.parse(data.joinedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(data).not.toHaveProperty("adminNote");
    expect(data.activity.map((a: { date: string; status: string }) => [a.date, a.status])).toEqual([
      [daysAgo(10), "done"],
      [daysAgo(3), "absent"],
      [futureDate(9), "upcoming"],
    ]);
    expect(data.activity[0]).toMatchObject({ code: events[0].code, location: "Bay Badminton Center" });
  });

  it("lets the member set their own email, falling back to the Google one when cleared", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await env.DB.prepare("UPDATE members SET google_email = 'alice@gmail.com' WHERE id = ?").bind(alice.id).run();
    expect((await anon.call(`${alice.base}/profile`)).data).toMatchObject({ email: "alice@gmail.com", emailFromGoogle: true });

    expect((await anon.call(`${alice.base}/email`, { email: "not-an-email" })).status).toBe(400);
    expect((await anon.call(`${alice.base}/email`, { email: " alice@work.com " })).status).toBe(200);
    expect((await anon.call(`${alice.base}/profile`)).data).toMatchObject({ email: "alice@work.com", emailFromGoogle: false });

    await anon.call(`${alice.base}/email`, { email: "" });
    expect((await anon.call(`${alice.base}/profile`)).data).toMatchObject({ email: "alice@gmail.com", emailFromGoogle: true });
  });

  it("gives the admin the same view plus a private 备注名", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await anon.call(`${alice.base}/email`, { email: "alice@work.com" });

    expect((await ctx.admin.call(`${ctx.base}/members/${alice.id}/note`, { note: "x".repeat(41) })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/members/${alice.id}/note`, { note: " 周六队长 " })).status).toBe(200);

    const { data } = await ctx.admin.call(`${ctx.base}/members/${alice.id}/profile`);
    expect(data).toMatchObject({ username: "Alice", email: "alice@work.com", adminNote: "周六队长", activity: [] });
    const { data: list } = await ctx.admin.call(`${ctx.base}/members`);
    expect(list.active.find((m: { id: string }) => m.id === alice.id).adminNote).toBe("周六队长");
    // The member never sees it.
    expect((await anon.call(`${alice.base}/profile`)).data).not.toHaveProperty("adminNote");

    await ctx.admin.call(`${ctx.base}/members/${alice.id}/note`, { note: "" });
    expect((await ctx.admin.call(`${ctx.base}/members/${alice.id}/profile`)).data.adminNote).toBe("");
  });

  it("keeps the admin endpoints admin-only", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const stranger = new Client();
    expect((await stranger.call(`${ctx.base}/members/${alice.id}/profile`)).status).toBe(401);
    expect((await stranger.call(`${ctx.base}/members/${alice.id}/note`, { note: "hi" })).status).toBe(401);
    expect((await stranger.call(`/api/m/not-a-token/profile`)).status).not.toBe(200);
  });
});
