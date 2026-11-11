import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
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
  it("opens once the event ends, for 7 days", () => {
    const end = new Date("2026-11-01T05:00:00Z");
    const e = { status: "closed" as const, end_at: end.toISOString() };
    expect(likeOpen(e, new Date(end.getTime() - 1))).toBe(false);
    expect(likeOpen(e, end)).toBe(true);
    expect(likeOpen(e, new Date(end.getTime() + 7 * 24 * HOUR))).toBe(true);
    expect(likeOpen(e, new Date(end.getTime() + 7 * 24 * HOUR + 1))).toBe(false);
    expect(likeOpen({ ...e, status: "cancelled" as const }, end)).toBe(false);
  });

  it("gives up to 3 likes to others who played, anonymously, and ranks who got the most", async () => {
    const { ctx, e, people } = await played(["Amy", "Bob", "Cat", "Dan", "Eve"]);
    const [amy, bob, cat, dan, eve] = people as [(typeof people)[0], ...typeof people];

    const panel = (await anon.call(`${amy.base}/events/${e.id}/likes`)).data;
    expect(panel).toMatchObject({ open: true, given: 0, received: 0 });
    // Everyone else who played, the Owner (Jay, not signed up) not among them, never Amy herself.
    expect(panel.people.map((p: { name: string }) => p.name)).toEqual(["Bob", "Cat", "Dan", "Eve"]);

    expect((await like(amy.base, e.id, bob!.id)).data.given).toBe(1);
    // A second tap on the same person changes nothing.
    expect((await like(amy.base, e.id, bob!.id)).data.given).toBe(1);
    await like(amy.base, e.id, cat!.id);
    await like(amy.base, e.id, dan!.id);
    const over = await like(amy.base, e.id, eve!.id);
    expect(over.status).toBe(400);
    expect(over.data.error.message).toBe("每场最多点 3 个赞");
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
    expect(card.likes).toEqual({ open: true, given: 0, received: 2 });
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
  });

  it("only after the event ends and for 7 days, never on a cancelled one", async () => {
    const { e, people } = await played(["Amy", "Bob"], -HOUR);
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
    await ago(8 * 24 * HOUR);
    const late = await like(amy.base, e.id, bob.id, false);
    expect(late.status).toBe(400);
    // Closed for changes, but the count stays on the card.
    expect((await anon.call(`${bob.base}/events/${e.id}`)).data.event.likes).toEqual({
      open: false,
      given: 0,
      received: 1,
    });

    await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e.id).run();
    expect((await anon.call(`${amy.base}/events/${e.id}/likes`)).status).toBe(400);
  });
});
