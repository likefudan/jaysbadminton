import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
import { likeCap } from "../src/shared/rules";
import { likeOpen } from "../src/worker/likes";
import { Client, approveMember, createTestEvent, setUpAdmin } from "./helpers";

const anon = new Client();
const today = toPacific(new Date()).date;
const HOUR = 3600_000;

/** An event that ended an hour ago (or `endedAgo` ms ago), with these members on it. */
async function played(names: string[], endedAgo = HOUR) {
  const ctx = await setUpAdmin();
  const people = [];
  for (const n of names) people.push(await approveMember(ctx, n));
  const e = await createTestEvent(ctx);
  for (const p of people) await anon.call(`${p.base}/events/${e.id}/signup`, { friends: [] });
  const end = Date.now() - endedAgo;
  await env.DB.prepare("UPDATE events SET status = 'closed', date = ?, start_at = ?, end_at = ? WHERE id = ?")
    .bind(today, new Date(end - 2 * HOUR).toISOString(), new Date(end).toISOString(), e.id)
    .run();
  return { ctx, e, people };
}

const like = (base: string, eventId: number, to: string, on = true) =>
  anon.call(`${base}/events/${eventId}/likes`, { to, on });

describe("点赞", () => {
  it("opens once the event ends, for the hours set", () => {
    const end = new Date("2026-11-01T05:00:00Z");
    const e = { status: "closed" as const, end_at: end.toISOString() };
    expect(likeOpen(e, 24, new Date(end.getTime() - 1))).toBe(false);
    expect(likeOpen(e, 24, end)).toBe(true);
    expect(likeOpen(e, 24, new Date(end.getTime() + 24 * HOUR))).toBe(true);
    expect(likeOpen(e, 24, new Date(end.getTime() + 24 * HOUR + 1))).toBe(false);
    expect(likeOpen({ ...e, status: "cancelled" as const }, 24, end)).toBe(false);
  });

  it("lets each like a share of the players, rounded down, at least 1", () => {
    expect(likeCap(20, 15)).toBe(3);
    expect(likeCap(13, 15)).toBe(1);
    expect(likeCap(4, 15)).toBe(1);
    expect(likeCap(40, 15)).toBe(6);
    expect(likeCap(10, 50)).toBe(5);
  });

  it("gives likes up to the share set to others who played, anonymously, and ranks who got the most", async () => {
    const { ctx, e, people } = await played(["Amy", "Bob", "Cat", "Dan", "Eve"]);
    const [amy, bob, cat, dan, eve] = people as [(typeof people)[0], ...typeof people];

    // 5 played: 15% of them rounds down to 0, so 1 each; at 60%, 3 each.
    expect((await anon.call(`${amy.base}/events/${e.id}/likes`)).data).toMatchObject({ max: 1, hours: 24 });
    expect((await ctx.admin.call(`${ctx.base}/settings`, { likePct: 0 })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/settings`, { likePct: 60 })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.likes).toEqual({ hours: 24, pct: 60 });
    const panel = (await anon.call(`${amy.base}/events/${e.id}/likes`)).data;
    expect(panel).toMatchObject({ open: true, max: 3, given: 0, received: 0 });
    // Everyone else who played, the Owner (Jay, not signed up) not among them, never Amy herself.
    expect(panel.people.map((p: { name: string }) => p.name)).toEqual(["Bob", "Cat", "Dan", "Eve"]);

    expect((await like(amy.base, e.id, bob!.id)).data.given).toBe(1);
    // A second tap on the same person changes nothing.
    expect((await like(amy.base, e.id, bob!.id)).data.given).toBe(1);
    await like(amy.base, e.id, cat!.id);
    await like(amy.base, e.id, dan!.id);
    const over = await like(amy.base, e.id, eve!.id);
    expect(over.status).toBe(400);
    expect(over.data.error.message).toBe("这场最多点 3 个赞");
    // Taking one back frees a like.
    await like(amy.base, e.id, dan!.id, false);
    expect((await like(amy.base, e.id, eve!.id)).data.given).toBe(3);

    // Not themselves, and not someone who didn't play.
    expect((await like(bob!.base, e.id, bob!.id)).status).toBe(400);
    const other = await approveMember(ctx, "Fay");
    expect((await like(bob!.base, e.id, other.id)).status).toBe(400);
    expect((await anon.call(`${other.base}/events/${e.id}/likes`)).status).toBe(400);
    await like(cat!.base, e.id, bob!.id);

    // Bob sees how many, never who: the card and the panel carry counts only.
    const card = (await anon.call(`${bob!.base}/events/${e.id}`)).data.event;
    expect(card.likes).toEqual({ open: true, max: 3, given: 0, received: 2 });
    const bobPanel = (await anon.call(`${bob!.base}/events/${e.id}/likes`)).data;
    expect(bobPanel.received).toBe(2);
    expect(JSON.stringify(bobPanel)).not.toContain("given_by");
    expect(bobPanel.people.every((p: { liked: boolean }) => !p.liked)).toBe(true);

    const { board } = (await ctx.admin.call(`${ctx.base}/leaderboard`)).data;
    expect(board.likes.map((r: { name: string; value: number }) => [r.name, r.value])).toEqual([
      ["Bob", 2],
      ["Cat", 1],
      ["Eve", 1],
    ]);
    expect(board.monthly.likes).toHaveLength(3);

    // Marked absent: their likes, given and got, stop counting.
    await env.DB.prepare("UPDATE registrations SET attended = 0 WHERE event_id = ? AND member_id = ?")
      .bind(e.id, cat!.id)
      .run();
    const after = (await ctx.admin.call(`${ctx.base}/leaderboard`)).data.board;
    expect(after.likes.map((r: { name: string; value: number }) => [r.name, r.value])).toEqual([
      ["Bob", 1],
      ["Eve", 1],
    ]);
    expect((await like(cat!.base, e.id, eve!.id)).status).toBe(400);
    // Amy's like for Cat still counts as given, and she can take it back: Cat stays at the end.
    const amyPanel = (await anon.call(`${amy.base}/events/${e.id}/likes`)).data;
    expect(amyPanel.given).toBe(3);
    expect(amyPanel.people.map((p: { name: string; liked: boolean }) => [p.name, p.liked])).toEqual([
      ["Bob", true],
      ["Dan", false],
      ["Eve", true],
      ["Cat", true],
    ]);
    expect((await like(amy.base, e.id, dan!.id)).status).toBe(400);
    // With Cat absent, 4 played: 60% of them is 2 each, which Amy already gave.
    expect((await like(amy.base, e.id, cat!.id, false)).data).toMatchObject({ given: 2, max: 2 });
    expect((await like(amy.base, e.id, dan!.id)).status).toBe(400);
  });

  it("only after the event ends and for the hours set, never on a cancelled one", async () => {
    const { ctx, e, people } = await played(["Amy", "Bob"], -HOUR);
    const [amy, bob] = people as [(typeof people)[0], (typeof people)[0]];
    // Still on: no 点赞 yet.
    expect((await anon.call(`${amy.base}/events/${e.id}`)).data.event.likes).toBeNull();
    expect((await like(amy.base, e.id, bob.id)).data.error.message).toBe("活动结束后才能点赞");

    const ago = (ms: number) =>
      env.DB.prepare("UPDATE events SET end_at = ? WHERE id = ?")
        .bind(new Date(Date.now() - ms).toISOString(), e.id)
        .run();
    await ago(HOUR);
    expect((await like(amy.base, e.id, bob.id)).status).toBe(200);
    await ago(25 * HOUR);
    const late = await like(amy.base, e.id, bob.id, false);
    expect(late.data.error.message).toBe("点赞已截止，活动结束后 24 小时内可以点赞");
    // Closed for changes, but the count stays on the card.
    expect((await anon.call(`${bob.base}/events/${e.id}`)).data.event.likes).toEqual({
      open: false,
      max: 0,
      given: 0,
      received: 1,
    });
    // Given 48 hours in 设置, it is open again.
    expect((await ctx.admin.call(`${ctx.base}/settings`, { likeHours: 721 })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/settings`, { likeHours: 48 })).status).toBe(200);
    expect((await like(amy.base, e.id, bob.id, false)).status).toBe(200);

    await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e.id).run();
    expect((await anon.call(`${amy.base}/events/${e.id}/likes`)).status).toBe(400);
  });
});
