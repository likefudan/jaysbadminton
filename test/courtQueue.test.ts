import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { courtPhase, queueWait } from "../src/shared/courtQueue";
import { Client, approveMember, createTestEvent, setUpAdmin } from "./helpers";

const anon = new Client();
const minutesFrom = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 60_000);

/** An event with 球场排队 on, Alice signed up and Bob not. */
async function scenario(round = 45) {
  const ctx = await setUpAdmin();
  const e = await createTestEvent(ctx, { queueRoundMin: round });
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: [] });
  const q = `/events/${e.id}/queue`;
  const card = async (base: string) => (await anon.call(`${base}/events/${e.id}`)).data.event as { queue: any } | null;
  return { ctx, e, alice, bob, q, card };
}

describe("球场排队", () => {
  it("is off unless the event turns it on, and checks the round length", async () => {
    const ctx = await setUpAdmin();
    const off = await createTestEvent(ctx);
    expect(off.queueRoundMin).toBeNull();
    const alice = await approveMember(ctx, "Alice");
    await anon.call(`${alice.base}/events/${off.id}/signup`, { friends: [] });
    expect((await anon.call(`${alice.base}/events/${off.id}`)).data.event.queue).toBeNull();
    const add = await anon.call(`${alice.base}/events/${off.id}/queue/accounts`, { username: "a", password: "1" });
    expect(add.status).toBe(400);

    const bad = await ctx.admin.call(`${ctx.base}/events`, {
      date: off.date,
      startTime: "19:00",
      endTime: "21:00",
      location: "Bay Badminton Center",
      deadlineDays: 1,
      deadlineHours: 0,
      queueRoundMin: 5,
    });
    expect(bad.status).toBe(400);
    // Turned on later from 修改活动, and off again.
    const on = await ctx.admin.call(`${ctx.base}/events/${off.id}/edit`, {
      date: off.date,
      startTime: off.startTime,
      endTime: off.endTime,
      location: off.location,
      queueRoundMin: 40,
    });
    expect(on.data.queueRoundMin).toBe(40);
    expect((await anon.call(`${alice.base}/events/${off.id}`)).data.event.queue).toMatchObject({ roundMin: 40 });
  });

  it("goes with the venue: 最近的场馆 remembers it from the venue's latest event", async () => {
    const ctx = await setUpAdmin();
    const venue = async (name: string) =>
      ((await ctx.admin.call(`${ctx.base}/events/defaults`)).data.locations as any[]).find((v) => v.name === name);
    const e = await createTestEvent(ctx, { location: "Queue Hall", queueRoundMin: 40 });
    await createTestEvent(ctx, { location: "Quiet Gym" });
    expect((await venue("Queue Hall")).queueRoundMin).toBe(40);
    expect((await venue("Quiet Gym")).queueRoundMin).toBeNull();
    // Turned off later from 修改活动: the venue forgets it too.
    await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      queueRoundMin: null,
    });
    expect((await venue("Queue Hall")).queueRoundMin).toBeNull();
  });

  it("shares accounts with everyone on the event, and only the adder or the runner removes one", async () => {
    const { alice, bob, q, card, e } = await scenario();
    expect((await anon.call(`${alice.base}${q}/accounts`, { username: " Mark ", password: "1357" })).status).toBe(200);
    await anon.call(`${alice.base}${q}/accounts`, { username: "Coco", password: "2468" });
    // The same username twice (any case) is refused.
    expect((await anon.call(`${alice.base}${q}/accounts`, { username: "mark", password: "x" })).status).toBe(400);
    expect((await anon.call(`${alice.base}${q}/accounts`, { username: "Ben", password: "" })).status).toBe(400);

    const mine = (await card(alice.base))!.queue;
    expect(mine.accounts.map((a: any) => [a.username, a.password, a.addedBy, a.mine])).toEqual([
      ["Mark", "1357", "Alice", true],
      ["Coco", "2468", "Alice", true],
    ]);
    // Bob isn't on the event: he sees no accounts and can't add any.
    expect((await card(bob.base))?.queue ?? null).toBeNull();
    expect((await anon.call(`${bob.base}${q}/accounts`, { username: "Ben", password: "9" })).status).toBe(400);

    // Once signed up he sees them, but can't remove Alice's.
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    const seen = (await card(bob.base))!.queue;
    expect(seen.accounts.map((a: any) => a.mine)).toEqual([false, false]);
    const markId = seen.accounts[0].id;
    expect((await anon.call(`${bob.base}${q}/accounts/${markId}/remove`, {})).status).toBe(400);
    expect((await anon.call(`${alice.base}${q}/accounts/${markId}/remove`, {})).status).toBe(200);
    expect((await card(alice.base))!.queue.accounts.map((a: any) => a.username)).toEqual(["Coco"]);
  });

  it("enters, corrects and removes courts, counting from now", async () => {
    const { alice, q, card } = await scenario(45);
    for (const username of ["Mark", "Ben", "Coco", "Yixing", "Zhichun"])
      await anon.call(`${alice.base}${q}/accounts`, { username, password: "1" });

    // Playing on 7 with 4 minutes left; queued second on 8, 49 minutes to wait.
    const play = await anon.call(`${alice.base}${q}/courts`, {
      court: 7,
      position: 0,
      minutes: 4,
      accounts: ["mark", "Ben", "Coco", "Yixing"],
    });
    expect(play.status).toBe(200);
    await anon.call(`${alice.base}${q}/courts`, { court: 8, position: 2, minutes: 49, accounts: ["Zhichun"] });
    let courts = (await card(alice.base))!.queue.courts;
    expect(courts.map((c: any) => [c.court, c.position, c.accounts])).toEqual([
      [7, 0, ["Mark", "Ben", "Coco", "Yixing"]],
      [8, 2, ["Zhichun"]],
    ]);
    expect(courts[0].startsAt).toBeNull();
    expect(minutesFrom(courts[0].endsAt)).toBe(4);
    expect(minutesFrom(courts[1].startsAt)).toBe(49);
    expect(minutesFrom(courts[1].endsAt)).toBe(49 + 45);
    expect(courts[0].createdBy).toBe("Alice");

    // Correct the wait and the group; then the other court ends early and is removed.
    const fix = await anon.call(`${alice.base}${q}/courts`, {
      id: courts[1].id,
      court: 8,
      position: 1,
      minutes: 10,
      accounts: ["Zhichun", "Mark"],
    });
    expect(fix.status).toBe(200);
    await anon.call(`${alice.base}${q}/courts/${courts[0].id}/remove`, {});
    courts = (await card(alice.base))!.queue.courts;
    expect(courts).toHaveLength(1);
    expect(courts[0]).toMatchObject({ court: 8, position: 1, accounts: ["Zhichun", "Mark"] });
    expect(minutesFrom(courts[0].startsAt)).toBe(10);

    // Groups must be 1-4 accounts shared on the event.
    const bad = (body: object) =>
      anon.call(`${alice.base}${q}/courts`, { court: 3, position: 0, minutes: 10, ...body });
    expect((await bad({ accounts: [] })).status).toBe(400);
    expect((await bad({ accounts: ["Nobody"] })).status).toBe(400);
    expect((await bad({ accounts: ["Mark", "Ben", "Coco", "Yixing", "Zhichun"] })).status).toBe(400);
    expect((await bad({ accounts: ["Mark"], court: 0 })).status).toBe(400);
    expect((await bad({ accounts: ["Mark"], position: 4 })).status).toBe(400);
    expect((await bad({ accounts: ["Mark"], minutes: 0 })).status).toBe(400);
  });

  it("goes away a few hours after the event ends, and with the event when it is deleted", async () => {
    const { ctx, e, alice, q, card } = await scenario();
    await anon.call(`${alice.base}${q}/accounts`, { username: "Mark", password: "1" });
    await env.DB.prepare("UPDATE events SET end_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 4 * 3600_000).toISOString(), e.id)
      .run();
    expect((await card(alice.base))?.queue ?? null).toBeNull();
    expect((await anon.call(`${alice.base}${q}/accounts`, { username: "Ben", password: "1" })).status).toBe(400);

    await ctx.admin.call(`${ctx.base}/events/${e.id}/cancel`, {});
    const gone = await ctx.admin.call(`${ctx.base}/events/${e.id}/delete`, { password: "initial-password" });
    expect(gone.status).toBe(200);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM queue_accounts WHERE event_id = ?")
      .bind(e.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("courtPhase / queueWait", () => {
  const at = (min: number) => new Date(Date.parse("2026-10-24T03:00:00Z") + min * 60_000).toISOString();
  const now = Date.parse("2026-10-24T03:00:00Z");

  it("counts down while playing, then is done", () => {
    expect(courtPhase({ startsAt: null, endsAt: at(4) }, now)).toEqual({ phase: "playing", minutes: 4 });
    expect(courtPhase({ startsAt: null, endsAt: at(4) }, now + 3.5 * 60_000)).toEqual({ phase: "playing", minutes: 1 });
    expect(courtPhase({ startsAt: null, endsAt: at(4) }, now + 4 * 60_000)).toEqual({ phase: "done" });
  });

  it("waits while queued, then plays its round", () => {
    const c = { startsAt: at(49), endsAt: at(94) };
    expect(courtPhase(c, now)).toEqual({ phase: "queued", minutes: 49 });
    expect(courtPhase(c, now + 50 * 60_000)).toEqual({ phase: "playing", minutes: 44 });
    expect(courtPhase(c, now + 94 * 60_000)).toEqual({ phase: "done" });
  });

  it("estimates the wait from the screen", () => {
    expect(queueWait(4, 1, 45)).toBe(4);
    expect(queueWait(4, 2, 45)).toBe(49);
    expect(queueWait(4, 3, 45)).toBe(94);
  });
});
