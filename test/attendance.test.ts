import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { activityLevel, attendanceRate } from "../src/shared/attendance";
import { daysBefore, windowStart } from "../src/worker/attendance";
import { GOOGLE, appoint, approveMember, futureDate, request, setUpAdmin } from "./helpers";

const today = futureDate(0);
const day = (back: number) => daysBefore(today, back);

let next = 1;
/** An event `back` days ago (already started), with the given sign-ups: [memberId, attended]. */
async function past(back: number, signups: [string, 0 | 1][], status = "finalized", friends: string[] = []) {
  const id = next++;
  const date = day(back);
  const start = new Date(Date.now() - (back * 24 + 1) * 3600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO events (id, number, code, date, start_at, end_at, location, deadline_at, deadline_offset_min, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Gym', ?, 1440, ?, ?)`,
  )
    .bind(id, `n${id}`, `c${id}`, date, start, start, start, status, start)
    .run();
  for (const [m, attended] of signups)
    await env.DB.prepare(
      `INSERT INTO registrations (event_id, member_id, friend_index, attended, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    )
      .bind(id, m, attended, start, start)
      .run();
  for (const [i, m] of friends.entries())
    await env.DB.prepare(
      `INSERT INTO registrations (event_id, member_id, friend_index, friend_name, attended, created_at, updated_at)
       VALUES (?, ?, ?, 'F', 1, ?, ?)`,
    )
      .bind(id, m, i + 1, start, start)
      .run();
  return id;
}

const joinedAgo = (id: string, back: number) =>
  env.DB.prepare("UPDATE members SET approved_at = ? WHERE id = ?")
    .bind(new Date(Date.now() - back * 86_400_000).toISOString(), id)
    .run();

describe("出勤统计", () => {
  it("counts attended events, the rate since joining, no-shows and the last time they came", async () => {
    next = 1;
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const newbie = await approveMember(ctx, "Newbie");
    const owner = (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;
    for (const id of [owner, alice.id, bob.id]) await joinedAgo(id, 400);
    await joinedAgo(newbie.id, 10);

    await past(100, [
      [alice.id, 1],
      [bob.id, 1],
    ]);
    await past(40, [[alice.id, 1]]);
    await past(20, [[alice.id, 0]]); // signed up, marked absent
    await past(
      5,
      [
        [alice.id, 1],
        [newbie.id, 1],
      ],
      "closed",
      [bob.id],
    ); // Bob only brought a friend; he himself didn't sign up
    await past(3, [[alice.id, 1]], "cancelled"); // cancelled: not held
    // Signed up for an event that hasn't started: not counted yet.
    await env.DB.prepare(
      `INSERT INTO events (id, number, code, date, start_at, end_at, location, deadline_at, deadline_offset_min, status, created_at)
       VALUES (99, 'n99', 'c99', ?, ?, ?, 'Gym', ?, 1440, 'open', ?)`,
    )
      .bind(futureDate(2), new Date(Date.now() + 86_400_000).toISOString(), "x", "x", "x")
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations (event_id, member_id, friend_index, attended, created_at, updated_at) VALUES (99, ?, 0, 1, 'x', 'x')",
    )
      .bind(bob.id)
      .run();

    const res = await ctx.admin.call(`${ctx.base}/members/attendance`);
    expect(res.status).toBe(200);
    expect(res.data.window).toBe("90");
    expect(res.data.held).toBe(3); // 40, 20 and 5 days ago
    const by = Object.fromEntries(res.data.members.map((m: { id: string }) => [m.id, m]));
    expect(by[alice.id]).toMatchObject({ attended: 2, held: 3, noShows: 1, lastDate: day(5), daysSince: 5 });
    expect(by[bob.id]).toMatchObject({ attended: 0, held: 3, noShows: 0, lastDate: day(100), daysSince: 100 });
    expect(by[newbie.id]).toMatchObject({ attended: 1, held: 1, lastDate: day(5) });
    expect(by[owner]).toMatchObject({ attended: 0, lastDate: null, daysSince: null });
    expect(activityLevel(by[alice.id])).toBe("active");
    expect(activityLevel(by[bob.id])).toBe("inactive");
    expect(activityLevel(by[owner])).toBe("inactive");
    expect(attendanceRate(by[alice.id])).toBe(67);

    const all = await ctx.admin.call(`${ctx.base}/members/attendance?window=all`);
    expect(all.data.held).toBe(4);
    const allBy = Object.fromEntries(all.data.members.map((m: { id: string }) => [m.id, m]));
    expect(allBy[alice.id]).toMatchObject({ attended: 3, held: 4 });

    const d = await ctx.admin.call(`${ctx.base}/members/${alice.id}/attendance?window=30`);
    expect(d.status).toBe(200);
    expect(d.data).toMatchObject({ attended: 1, held: 2, noShows: 1, window: "30" });
    expect(d.data.weeks).toHaveLength(12);
    expect(d.data.weeks[11]).toBe(1); // 5 days ago
    expect(by[alice.id].weeks).toEqual(d.data.weeks);
    expect(d.data.weeks.reduce((a: number, b: number | null) => a + (b ?? 0), 0)).toBe(2); // 5 and 40 days ago

    const n = await ctx.admin.call(`${ctx.base}/members/${newbie.id}/attendance`);
    expect(n.data.weeks.slice(0, 10).every((w: number | null) => w === null)).toBe(true);
    expect((await ctx.admin.call(`${ctx.base}/members/M999/attendance`)).status).toBe(404);
  });

  it("is for the Owner and admins, not organizers", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const org = await appoint(alice.id, "alice");
    const adm = await appoint(bob.id, "bob", "admin");
    expect((await request(`${GOOGLE}/members/attendance`, org)).status).toBe(403);
    expect((await request(`${GOOGLE}/members/${bob.id}/attendance`, org)).status).toBe(403);
    expect((await request(`${GOOGLE}/members/attendance`, adm)).status).toBe(200);
  });

  it("levels and windows", () => {
    expect(activityLevel({ daysSince: 30, joinedDays: 400 })).toBe("active");
    expect(activityLevel({ daysSince: 31, joinedDays: 400 })).toBe("quiet");
    expect(activityLevel({ daysSince: 90, joinedDays: 400 })).toBe("quiet");
    expect(activityLevel({ daysSince: 91, joinedDays: 400 })).toBe("inactive");
    expect(activityLevel({ daysSince: null, joinedDays: 10 })).toBe("quiet");
    expect(activityLevel({ daysSince: null, joinedDays: 40 })).toBe("inactive");
    expect(attendanceRate({ attended: 0, held: 0 })).toBeNull();
    expect(windowStart("all", "2026-11-18")).toBe("");
    expect(windowStart("year", "2026-11-18")).toBe("2026-01-01");
    expect(windowStart("30", "2026-11-18")).toBe("2026-10-20");
  });
});
