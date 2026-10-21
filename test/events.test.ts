import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/worker/index";
import { describe, expect, it } from "vitest";
import { Client, approveMember, billingScenario, createTestEvent, futureDate, setUpAdmin, tokenOf } from "./helpers";

const anon = new Client();
const expire = (id: number) =>
  env.DB.prepare("UPDATE events SET deadline_at = ? WHERE id = ?")
    .bind(new Date(Date.now() - 60_000).toISOString(), id)
    .run();

describe("creating events", () => {
  it("computes the deadline from the offset and assigns date codes", async () => {
    const ctx = await setUpAdmin();
    const date = futureDate(7);
    const e = await createTestEvent(ctx, { date, deadlineDays: 1, deadlineHours: 2 });
    expect(e.code).toBe(date.slice(5, 7) + date.slice(8));
    expect(Date.parse(e.deadlineAt)).toBe(
      Date.parse(`${date}T19:00:00-07:00`) - 26 * 3600_000 + (date >= "2026-11-01" ? 3600_000 : 0),
    );
    const second = await createTestEvent(ctx, { date });
    expect(second.code).toBe(`${e.code}B`);
  });

  it("remembers the last times, venue with its address, and deadline offset as defaults", async () => {
    const ctx = await setUpAdmin();
    const address = "1 Wellness Way, San Jose, CA 95131";
    const e = await createTestEvent(ctx, {
      startTime: "20:00",
      endTime: "22:30",
      location: "Wellness Gym",
      address,
      deadlineDays: 2,
      deadlineHours: 6,
    });
    expect(e).toMatchObject({ location: "Wellness Gym", address });
    await createTestEvent(ctx, { location: "Bay Center", address: "2 Bay St, Fremont, CA 94538" });
    // Using a venue again without an address keeps the one it already had.
    await createTestEvent(ctx, {
      location: "Wellness Gym",
      address: "",
      startTime: "20:00",
      endTime: "22:30",
      deadlineDays: 2,
      deadlineHours: 6,
      date: futureDate(8),
    });
    const { data } = await ctx.admin.call(`${ctx.base}/events/defaults`);
    expect(data).toMatchObject({
      startTime: "20:00",
      endTime: "22:30",
      location: "Wellness Gym",
      address,
      deadlineDays: 2,
      deadlineHours: 6,
    });
    expect(data.locations).toEqual([
      { name: "Wellness Gym", address, queueRoundMin: null },
      { name: "Bay Center", address: "2 Bay St, Fremont, CA 94538", queueRoundMin: null },
    ]);
  });

  it("forgets a recent venue from 最近的场馆", async () => {
    const ctx = await setUpAdmin();
    await createTestEvent(ctx, { location: "Old Gym", address: "1 Old St, San Jose, CA 95131" });
    await createTestEvent(ctx, { location: "Test Gym", address: "" });
    expect((await ctx.admin.call(`${ctx.base}/locations/remove`, { name: "Test Gym" })).status).toBe(200);
    const { data } = await ctx.admin.call(`${ctx.base}/events/defaults`);
    expect(data.locations.map((l: { name: string }) => l.name)).not.toContain("Test Gym");
    expect(data.locations).toContainEqual({
      name: "Old Gym",
      address: "1 Old St, San Jose, CA 95131",
      queueRoundMin: null,
    });
    expect(data.location).toBe(""); // it was the last one used, so it no longer pre-fills either
  });

  it("refuses a deadline that is already in the past", async () => {
    const ctx = await setUpAdmin();
    const res = await ctx.admin.call(`${ctx.base}/events`, {
      date: futureDate(1),
      startTime: "19:00",
      endTime: "21:00",
      location: "X",
      deadlineDays: 3,
      deadlineHours: 0,
    });
    expect(res.data.error.message).toBe("按这个提前量算出的截止时间已经过了，请调整");
  });
});

describe("the admin's event list", () => {
  it("shows 30 past events at first and more on request", async () => {
    const ctx = await setUpAdmin();
    const stmts = Array.from({ length: 35 }, (_, i) => {
      const at = new Date(Date.UTC(2025, 0, 1 + i, 20)).toISOString(); // 2025-01-01 … 2025-02-04
      const day = at.slice(0, 10);
      return env.DB.prepare(
        `INSERT INTO events (number, code, date, start_at, end_at, location, address, title, deadline_at, deadline_offset_min, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'Gym', '', '', ?, 0, 'cancelled', ?)`,
      ).bind(`jbm${day.replace(/-/g, "")}`, day.slice(5).replace("-", ""), day, at, at, at, at);
    });
    await env.DB.batch(stmts);
    const first = (await ctx.admin.call(`${ctx.base}/events`)).data;
    expect(first.past).toHaveLength(30);
    expect(first.morePast).toBe(true);
    expect(first.past[0].date).toBe("2025-02-04"); // newest first
    const more = (await ctx.admin.call(`${ctx.base}/events?past=60`)).data;
    expect(more.past).toHaveLength(35);
    expect(more.morePast).toBe(false);
    expect(more.past.at(-1).date).toBe("2025-01-01");
  });
});

describe("member sign-up", () => {
  it("signs up with friends, edits, and cancels before the deadline", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const alice = await approveMember(ctx, "Alice");

    expect((await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: ["Tom", ""] })).status).toBe(200);
    let mine = (await anon.call(`${alice.base}/events`)).data.events[0];
    expect(mine.myFriends).toEqual(["Tom", ""]);
    expect(mine.headcount).toBe(3);

    // Anyone can see how many signed up, but not who.
    const pub = (await anon.call(`/api/public/events/${e.code}`)).data;
    expect(pub.headcount).toBe(3);
    expect(JSON.stringify(pub)).not.toMatch(/Alice|Tom/);
    expect(JSON.stringify((await anon.call("/api/public/home")).data)).not.toMatch(/Tom|Alice的朋友/);

    await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: [] });
    mine = (await anon.call(`${alice.base}/events`)).data.events[0];
    expect(mine.myFriends).toEqual([]);
    expect(mine.headcount).toBe(1);

    await anon.call(`${alice.base}/events/${e.id}/cancel`, {});
    mine = (await anon.call(`${alice.base}/events`)).data.events[0];
    expect(mine.myFriends).toBeNull();
  });

  it("enforces the friend cap from settings", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const bob = await approveMember(ctx, "Bob");
    const over = await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d"] });
    expect(over.data.error.message).toBe("最多带 3 个朋友");
    await ctx.admin.call(`${ctx.base}/settings`, { friendCap: 4 });
    expect((await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d"] })).status).toBe(200);
  });

  it("lets a member keep friends the Owner added above the cap, but not add more", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const bob = await approveMember(ctx, "Bob");
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c"] });
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: bob.id, friends: ["d", "e"] });
    const keep = await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d", "Eve"] });
    expect(keep.status).toBe(200);
    expect((await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c"] })).status).toBe(200);
    const more = await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d"] });
    expect(more.data.error.message).toBe("最多带 3 个朋友");
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: bob.id, friends: ["d"] });
    const six = await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d", "e"] });
    expect(six.data.error.message).toBe("最多带 3 个朋友；现在的 4 个可以保留，但不能再加");
  });

  it("keeps each friend on their own row when the Owner removed one in the middle", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const eb = `${ctx.base}/events/${e.id}`;
    const bob = await approveMember(ctx, "Bob");
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["a", "", ""] });
    const rows = () =>
      env.DB.prepare(
        "SELECT friend_index, friend_name, attended FROM registrations WHERE event_id = ? AND member_id = ? ORDER BY friend_index",
      )
        .bind(e.id, bob.id)
        .all<{ friend_index: number; friend_name: string | null; attended: number }>()
        .then((r) => r.results);
    const [, , second, third] = await rows();
    await ctx.admin.call(
      `${eb}/roster/${(await env.DB.prepare("SELECT id FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index = ?").bind(e.id, bob.id, second!.friend_index).first<{ id: number }>())!.id}/remove`,
      {},
    );
    await ctx.admin.call(`${eb}/attendance`, {
      registrationId: (await env.DB.prepare(
        "SELECT id FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index = ?",
      )
        .bind(e.id, bob.id, third!.friend_index)
        .first<{ id: number }>())!.id,
      attended: false,
    });
    // Bob renames his first friend; the third keeps number 3 and its 未到 mark.
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["Amy", ""] });
    expect(await rows()).toEqual([
      { friend_index: 0, friend_name: null, attended: 1 },
      { friend_index: 1, friend_name: "Amy", attended: 1 },
      { friend_index: 3, friend_name: null, attended: 0 },
    ]);
    // A new friend goes after the last one; dropping one removes the last.
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["Amy", "", "Cat"] });
    expect((await rows()).map((r) => [r.friend_index, r.friend_name])).toEqual([
      [0, null],
      [1, "Amy"],
      [3, null],
      [4, "Cat"],
    ]);
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: ["Amy"] });
    expect((await rows()).map((r) => r.friend_index)).toEqual([0, 1]);
  });

  it("locks members out after the deadline, until the Owner reopens", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const carol = await approveMember(ctx, "Carol");
    await expire(e.id);

    const late = await anon.call(`${carol.base}/events/${e.id}/signup`, { friends: [] });
    expect(late.data.error.message).toBe("报名已截止，不能再修改");
    // Closed and not on it: no longer offered on 我的活动.
    expect((await anon.call(`${carol.base}/events`)).data.events).toEqual([]);

    const tooLate = await ctx.admin.call(`${ctx.base}/events/${e.id}/reopen`, { date: futureDate(30), time: "12:00" });
    expect(tooLate.data.error.message).toBe("截止时间最晚只能到活动结束");
    await ctx.admin.call(`${ctx.base}/events/${e.id}/reopen`, { date: e.date, time: "20:30" });
    expect((await anon.call(`${carol.base}/events/${e.id}/signup`, { friends: [] })).status).toBe(200);
  });

  it("closes expired events from the cron handler", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await expire(e.id);
    const ctx2 = createExecutionContext();
    await worker.scheduled!({ cron: "*/10 * * * *", scheduledTime: Date.now() } as ScheduledController, env, ctx2);
    await waitOnExecutionContext(ctx2);
    const row = await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(e.id).first("status");
    expect(row).toBe("closed");
  });
});

describe("Owner roster edits", () => {
  it("adds walk-ins as friends of a member without adding the member", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await expire(e.id);
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: owner,
      includeSelf: false,
      friends: ["路人甲", "", "", "", ""],
    });
    expect(res.status).toBe(200); // walk-ins ignore the friend cap
    expect(res.data.roster.map((r: { name: string }) => r.name)).toEqual([
      "路人甲",
      "Jay的朋友2",
      "Jay的朋友3",
      "Jay的朋友4",
      "Jay的朋友5",
    ]);
  });

  it("tells a member whose friends are on the list without them, and signing up keeps the friends", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const carol = await approveMember(ctx, "Carol");
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: carol.id,
      includeSelf: false,
      friends: ["Dan"],
    });
    const mine = (await anon.call(`${carol.base}/events`)).data.events.find((x: { id: number }) => x.id === e.id);
    expect(mine).toMatchObject({ myFriends: ["Dan"], selfSignedUp: false, canEdit: true, roster: null });
    await anon.call(`${carol.base}/events/${e.id}/signup`, { friends: ["Dan"] });
    const d = (await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data;
    expect(d.roster.map((r: { name: string; addedByOwner: boolean }) => [r.name, r.addedByOwner])).toEqual([
      ["Carol", false],
      ["Dan", true],
    ]);
    const after = (await anon.call(`${carol.base}/events`)).data.events.find((x: { id: number }) => x.id === e.id);
    expect(after.selfSignedUp).toBe(true);
  });

  it("replaces a member with a substitute and renames friends", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const dan = await approveMember(ctx, "Dan");
    const eve = await approveMember(ctx, "Eve");
    await anon.call(`${dan.base}/events/${e.id}/signup`, { friends: [""] });
    let d = (await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data;
    const danRow = d.roster.find((r: { name: string }) => r.name === "Dan");
    const friendRow = d.roster.find((r: { friendIndex: number }) => r.friendIndex === 1);

    d = (await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/${friendRow.id}/rename`, { name: "小李" })).data;
    d = (await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/${danRow.id}/remove`, {})).data;
    d = (
      await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
        memberId: eve.id,
        includeSelf: true,
        friends: [],
      })
    ).data;
    expect(d.roster.map((r: { name: string }) => r.name)).toEqual(["小李", "Eve"]);

    const dup = await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: eve.id,
      includeSelf: true,
      friends: [],
    });
    expect(dup.data.error.message).toBe("Eve 已经在名单上了");
  });

  it("cancels only before Finalize and blocks edits on cancelled events", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/cancel`, {});
    const home = (await anon.call("/api/public/home")).data;
    expect(home.currentEvents).toEqual([]);
    expect(home.pastEvents[0].status).toBe("cancelled");
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    const add = await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: owner,
      includeSelf: true,
      friends: [],
    });
    expect(add.data.error.message).toBe("这个活动已取消");
  });

  it("deactivating a member drops their sign-up on open events only", async () => {
    const ctx = await setUpAdmin();
    const open = await createTestEvent(ctx);
    const closed = await createTestEvent(ctx);
    const fay = await approveMember(ctx, "Fay");
    await anon.call(`${fay.base}/events/${open.id}/signup`, { friends: [] });
    await anon.call(`${fay.base}/events/${closed.id}/signup`, { friends: [] });
    await expire(closed.id); // past its deadline, not yet closed by the cron
    await ctx.admin.call(`${ctx.base}/members/${fay.id}/deactivate`, {});
    expect((await ctx.admin.call(`${ctx.base}/events/${open.id}`)).data.headcount).toBe(0);
    expect((await ctx.admin.call(`${ctx.base}/events/${closed.id}`)).data.headcount).toBe(1);
  });
});

describe("deadlines on read", () => {
  it("shows an event past its deadline as closed without writing to the database", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await expire(e.id);
    expect((await anon.call(`/api/public/events/${e.code}`)).data.status).toBe("closed");
    expect((await anon.call("/api/public/home")).data.currentEvents[0].status).toBe("closed");
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.status).toBe("closed");
    const row = await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(e.id).first<{ status: string }>();
    expect(row!.status).toBe("open"); // the cron stores it
  });
});

describe("emergency controls", () => {
  it("closes sign-up early so the event can be settled", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const gus = await approveMember(ctx, "Gus");
    await anon.call(`${gus.base}/events/${e.id}/signup`, { friends: [] });
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/close-now`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.status).toBe("closed");
    expect((await anon.call(`${gus.base}/events/${e.id}/cancel`, {})).data.error.message).toBe(
      "报名已截止，不能再修改",
    );
    const again = await ctx.admin.call(`${ctx.base}/events/${e.id}/close-now`, {});
    expect(again.data.error.message).toBe("只有报名中的活动可以提前截止");
    const fin = await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, {
      courtTotal: "20",
      shuttleCount: 1,
      shuttlePrice: "3",
    });
    expect(fin.status).toBe(200);
  });

  it("edits date, time and location but keeps the event code", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { deadlineDays: 1, deadlineHours: 0 });
    const newDate = futureDate(9);
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: newDate,
      startTime: "20:00",
      endTime: "22:00",
      location: "New Gym",
    });
    expect(res.data).toMatchObject({
      code: e.code,
      date: newDate,
      startTime: "20:00",
      endTime: "22:00",
      location: "New Gym",
      status: "open",
    });
    // An open event keeps its "1 day before start" deadline.
    expect(Date.parse(res.data.deadlineAt)).toBe(
      Date.parse((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.deadlineAt),
    );
    const start = await env.DB.prepare("SELECT start_at FROM events WHERE id = ?").bind(e.id).first<string>("start_at");
    expect(Date.parse(start!) - Date.parse(res.data.deadlineAt)).toBe(86400_000);
    expect((await anon.call(`/api/public/events/${e.code}`)).data.location).toBe("New Gym");
  });

  it("moves a reopened deadline with the start, and keeps it when only the venue changes", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { deadlineDays: 1, deadlineHours: 0 });
    await expire(e.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/reopen`, { date: e.date, time: "20:30" });
    const reopened = (await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.deadlineAt;
    // A venue fix: sign-up stays open until the reopened deadline.
    const fixed = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: "Fixed Gym",
    });
    expect(fixed.data).toMatchObject({ status: "open", deadlineAt: reopened, location: "Fixed Gym" });
    // Ending before the reopened deadline pulls it in to the end.
    const shorter = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: e.date,
      startTime: e.startTime,
      endTime: "20:00",
      location: "Fixed Gym",
    });
    expect(shorter.data.status).toBe("open");
    expect(Date.parse(shorter.data.deadlineAt)).toBe(Date.parse(reopened) - 30 * 60_000);
    // Moving the start an hour later moves the deadline with it.
    const moved = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: e.date,
      startTime: "20:00",
      endTime: "22:00",
      location: "Fixed Gym",
    });
    expect(moved.data.status).toBe("open");
    expect(Date.parse(moved.data.deadlineAt)).toBe(Date.parse(reopened) + 30 * 60_000);
  });

  it("closes sign-up when an edit moves the deadline into the past, and works after Finalize", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { deadlineDays: 3, deadlineHours: 0 });
    const soon = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: futureDate(1),
      startTime: "19:00",
      endTime: "21:00",
      location: "Gym",
    });
    expect(soon.data.status).toBe("closed");
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: owner,
      includeSelf: true,
      friends: ["x"],
    });
    await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, {
      courtTotal: "20",
      shuttleCount: 1,
      shuttlePrice: "3",
    });
    // Settled (Owner-only bill is auto-paid) → read-only.
    const locked = await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: futureDate(1),
      startTime: "19:00",
      endTime: "21:00",
      location: "Elsewhere",
    });
    expect(locked.data.error.message).toBe("这个活动已收齐归档，不能再修改");
  });
});

describe("Owner joins own event", () => {
  it("signs the Owner up when 我自己也报名 is ticked, and not otherwise", async () => {
    const ctx = await setUpAdmin();
    const withMe = await createTestEvent(ctx, { joinSelf: true });
    expect(
      withMe.roster.map((r: { memberName: string; addedByOwner: boolean }) => [r.memberName, r.addedByOwner]),
    ).toEqual([["Jay", false]]);
    const without = await createTestEvent(ctx, { joinSelf: false, startTime: "09:00", endTime: "11:00" });
    expect(without.roster).toEqual([]);
  });
});

describe("event title and public leaderboard switch", () => {
  it("keeps an optional title, editable later, and refuses one that is too long", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { title: "  HappyTuesday 比赛 " });
    expect(e.title).toBe("HappyTuesday 比赛");
    expect((await createTestEvent(ctx, { startTime: "08:00", endTime: "09:00" })).title).toBe("");
    expect(
      (
        await ctx.admin.call(`${ctx.base}/events`, {
          date: futureDate(9),
          startTime: "19:00",
          endTime: "21:00",
          location: "X",
          deadlineDays: 1,
          deadlineHours: 0,
          title: "长".repeat(31),
        })
      ).status,
    ).toBe(400);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, {
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      title: "决赛",
    });
    expect((await new Client().call(`/api/public/events/${e.code}`)).data.title).toBe("决赛");
  });

  it("hides the leaderboard from the public page when the Owner turns it off", async () => {
    const ctx = await setUpAdmin();
    expect((await new Client().call("/api/public/home")).data.leaderboard).not.toBeNull();
    await ctx.admin.call(`${ctx.base}/settings`, { showLeaderboard: false });
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.showLeaderboard).toBe(false);
    expect((await new Client().call("/api/public/home")).data.leaderboard).toBeNull();
  });
});

describe("who's coming", () => {
  it("shows signed-up members the whole list with friends, and nobody else", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { joinSelf: true });
    const ming = await approveMember(ctx, "小明");
    const bob = await approveMember(ctx, "Bob");
    const carol = await approveMember(ctx, "Carol");
    await anon.call(`${ming.base}/events/${e.id}/signup`, { friends: ["阿强", ""] });
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: [] });

    const mine = (await anon.call(`${ming.base}/events`)).data.events.find((x: { id: number }) => x.id === e.id);
    expect(mine.roster).toEqual([
      { name: "Jay", friendOf: null, mine: false, absent: false },
      { name: "小明", friendOf: null, mine: true, absent: false },
      { name: "阿强", friendOf: "小明", mine: true, absent: false },
      { name: "小明的朋友2", friendOf: "小明", mine: true, absent: false },
      { name: "Bob", friendOf: null, mine: false, absent: false },
    ]);
    expect(
      (await anon.call(`${bob.base}/events`)).data.events.find((x: { id: number }) => x.id === e.id).roster,
    ).toHaveLength(5);

    // Not signed up: just the count, like the public page.
    const theirs = (await anon.call(`${carol.base}/events`)).data.events.find((x: { id: number }) => x.id === e.id);
    expect(theirs.roster).toBeNull();
    expect(theirs.headcount).toBe(5);
    expect(JSON.stringify((await anon.call(`/api/public/events/${e.code}`)).data)).not.toContain("小明");
  });

  it("marks who did not come once the event is settled", async () => {
    const s = await billingScenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const list = (await new Client().call(`${s.alice.base}/events`)).data.events.find(
      (x: { id: number }) => x.id === s.e.id,
    ).roster;
    expect(list.find((r: { name: string }) => r.name === "Tom")).toMatchObject({
      friendOf: "Alice",
      mine: true,
      absent: true,
    });
    expect(list.filter((r: { absent: boolean }) => r.absent)).toHaveLength(1);
  });
});

describe("我的报名 (the Owner signs up from the admin page)", () => {
  it("signs up with friends, edits, cancels, and stops at Finalize", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { joinSelf: false });
    const eb = `${ctx.base}/events/${e.id}`;
    const mine = (d: { roster: { memberName: string; name: string; friendIndex: number }[] }) =>
      d.roster.filter((r) => r.memberName === "Jay").map((r) => r.name);

    const signed = await ctx.admin.call(`${eb}/self-signup`, { friends: ["阿强", "", "老王", "小李"] }); // no friend cap for the Owner
    expect(signed.status).toBe(200);
    expect(mine(signed.data)).toEqual(["Jay", "阿强", "Jay的朋友2", "老王", "小李"]);
    expect(mine((await ctx.admin.call(`${eb}/self-signup`, { friends: ["阿强"] })).data)).toEqual(["Jay", "阿强"]);

    // After the deadline the Owner can still change their own sign-up.
    await expire(e.id);
    expect((await ctx.admin.call(`${eb}/self-cancel`, {})).status).toBe(200);
    expect(mine((await ctx.admin.call(eb)).data)).toEqual([]);
    expect(mine((await ctx.admin.call(`${eb}/self-signup`, { friends: [] })).data)).toEqual(["Jay"]);

    // Bills exist after Finalize: own sign-up is locked (the roster editor still works).
    const ming = await approveMember(ctx, "小明");
    await env.DB.prepare(
      "INSERT INTO registrations (event_id, member_id, friend_index, attended, added_by_owner, created_at, updated_at) VALUES (?, ?, 0, 1, 0, ?, ?)",
    )
      .bind(e.id, ming.id, new Date().toISOString(), new Date().toISOString())
      .run();
    expect(
      (await ctx.admin.call(`${eb}/finalize`, { courtTotal: "40", shuttleCount: 2, shuttlePrice: "3" })).status,
    ).toBe(200);
    expect((await ctx.admin.call(`${eb}/self-signup`, { friends: ["x"] })).status).toBe(400);
    expect((await ctx.admin.call(`${eb}/self-cancel`, {})).status).toBe(400);
  });

  it("keeps more than 20 friends the Owner added from 添加人员", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx); // 我自己也报名 is ticked by default
    const eb = `${ctx.base}/events/${e.id}`;
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    const names = Array.from({ length: 22 }, (_, i) => `f${i + 1}`);
    await ctx.admin.call(`${eb}/roster/add`, { memberId: owner, friends: names.slice(0, 20) });
    await ctx.admin.call(`${eb}/roster/add`, { memberId: owner, friends: names.slice(20) });
    expect((await ctx.admin.call(`${eb}/self-signup`, { friends: names })).status).toBe(200);
    expect((await ctx.admin.call(`${eb}/self-signup`, { friends: [...names, "f23"] })).status).toBe(400);
  });

  it("has the same rules when the Owner signs up from their own member page (Google)", async () => {
    const ctx = await setUpAdmin();
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active.find(
      (m: { isOwner: boolean }) => m.isOwner,
    );
    const base = `/api/m/${tokenOf((await ctx.admin.call(`${ctx.base}/members/${owner.id}/regenerate`, {})).data.link)}`;
    const e = await createTestEvent(ctx, { joinSelf: false });
    const c = new Client();
    expect((await c.call(`${base}/events/${e.id}/signup`, { friends: ["a", "b", "c", "d", "e"] })).status).toBe(200); // past the cap of 3
    const mine = async () => (await c.call(`${base}/events`)).data.events.find((x: { id: number }) => x.id === e.id);
    expect(await mine()).toMatchObject({ friendCap: 20 });
    await expire(e.id);
    expect(await mine()).toMatchObject({ status: "closed", canEdit: true });
    expect((await c.call(`${base}/events/${e.id}/signup`, { friends: ["a"] })).status).toBe(200);
    expect((await c.call(`${base}/events/${e.id}/cancel`, {})).status).toBe(200);
    // A normal member is locked out after the deadline.
    const ming = await approveMember(ctx, "小明");
    expect((await c.call(`${ming.base}/events/${e.id}/signup`, { friends: [] })).status).toBe(400);
  });

  it("is only for the admin session", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    expect((await new Client().call(`${ctx.base}/events/${e.id}/self-signup`, { friends: [] })).status).toBe(401);
  });
});

describe("我的活动 (the member's events)", () => {
  it("lists their own events newest first, offers open ones, and folds paid-up past ones into history", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const c = new Client();
    const make = async (days: number) => createTestEvent(ctx, { date: futureDate(days), joinSelf: false });
    const [old, unpaid, soon, later, notMine, cancelled] = [
      await make(7),
      await make(8),
      await make(9),
      await make(10),
      await make(11),
      await make(12),
    ];
    for (const e of [old, unpaid, soon, later, cancelled])
      await c.call(`${alice.base}/events/${e.id}/signup`, { friends: e === old ? ["Tom"] : [] });
    const past = (id: number, daysAgo: number, status: string) => {
      const day = new Date(Date.now() - daysAgo * 86400_000).toISOString();
      return env.DB.prepare("UPDATE events SET status = ?, date = ?, start_at = ?, end_at = ? WHERE id = ?")
        .bind(status, day.slice(0, 10), day, day, id)
        .run();
    };
    const bill = (id: number, status: string) =>
      env.DB.prepare(
        "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents) VALUES (?, ?, 2500, 'x', ?, ?)",
      )
        .bind(id, alice.id, status, status === "paid" ? 2500 : 0)
        .run();
    await past(old.id, 30, "settled");
    await bill(old.id, "paid");
    await past(unpaid.id, 3, "finalized");
    await bill(unpaid.id, "unpaid");
    await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(cancelled.id).run();

    const r = (await c.call(`${alice.base}/events`)).data;
    // Current: theirs plus the one still open to join, newest first; the cancelled one is gone.
    expect(r.events.map((e: { id: number }) => e.id)).toEqual([notMine.id, later.id, soon.id, unpaid.id]);
    expect(r.events.find((e: { id: number }) => e.id === notMine.id).myFriends).toBeNull();
    expect(r.events.find((e: { id: number }) => e.id === unpaid.id).payment).toMatchObject({
      status: "unpaid",
      amountCents: 2500,
    });
    // Over and paid up: in history, briefly.
    expect(r.history).toEqual([
      {
        id: old.id,
        code: old.code,
        date: expect.any(String),
        title: "",
        location: "Bay Badminton Center",
        amountCents: 2500,
        attended: true,
        friends: 1,
      },
    ]);

    // Once paid, the finalized one moves to history too (newest first).
    await env.DB.prepare("UPDATE payments SET status = 'paid', amount_paid_cents = 2500 WHERE event_id = ?")
      .bind(unpaid.id)
      .run();
    const after = (await c.call(`${alice.base}/events`)).data;
    expect(after.history.map((h: { id: number }) => h.id)).toEqual([unpaid.id, old.id]);
    expect(after.events.map((e: { id: number }) => e.id)).toEqual([notMine.id, later.id, soon.id]);
  });

  it("shows a past, paid-up event in full on its own page: who came, their bill, paid", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const c = new Client();
    const [done, other] = [
      await createTestEvent(ctx, { date: futureDate(7), joinSelf: false }),
      await createTestEvent(ctx, { date: futureDate(8), joinSelf: false }),
    ];
    await c.call(`${alice.base}/events/${done.id}/signup`, { friends: [] });
    await c.call(`${bob.base}/events/${done.id}/signup`, { friends: [] });
    await c.call(`${bob.base}/events/${other.id}/signup`, { friends: [] });
    const day = new Date(Date.now() - 3 * 86400_000).toISOString();
    for (const id of [done.id, other.id])
      await env.DB.prepare("UPDATE events SET status = 'settled', date = ?, start_at = ?, end_at = ? WHERE id = ?")
        .bind(day.slice(0, 10), day, day, id)
        .run();
    await env.DB.prepare(
      "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents) VALUES (?, ?, 2500, 'x', 'paid', 2500)",
    )
      .bind(done.id, alice.id)
      .run();

    // In history on 我的活动, but its own page still has the whole card.
    expect((await c.call(`${alice.base}/events`)).data.history.map((h: { id: number }) => h.id)).toEqual([done.id]);
    const page = (await c.call(`${alice.base}/events/${done.id}`)).data.event;
    expect(page.roster.map((r: { name: string }) => r.name)).toEqual(["Alice", "Bob"]);
    expect(page.payment).toMatchObject({ amountCents: 2500, paidCents: 2500, status: "paid" });
    expect(page.canEdit).toBe(false);

    // Not theirs: the same card, but no roster, no bill and nothing to change.
    const notMine = (await c.call(`${alice.base}/events/${other.id}`)).data.event;
    expect(notMine).toMatchObject({ id: other.id, selfSignedUp: false, myFriends: null, roster: null, payment: null });
    expect(notMine.canEdit).toBe(false);
    expect(notMine.queue).toBeNull();
    expect(notMine.courts).toEqual([]);
  });

  it("a disabled member sees only their own events and bills, nothing to join", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await createTestEvent(ctx, { joinSelf: false });
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/deactivate`, {});
    expect((await new Client().call(`${alice.base}/events`)).data).toMatchObject({ events: [], history: [] });
  });
});

describe("activity notes", () => {
  it("saves multiline notes, exposes them to members, and supports preserving or clearing them", async () => {
    const ctx = await setUpAdmin();
    const notes = "请自带球拍\n提前十分钟到场";
    const e = await createTestEvent(ctx, { notes: `  ${notes}  ` });
    expect(e.notes).toBe(notes);
    const member = await approveMember(ctx, "小明");
    const memberEvent = () => anon.call(`${member.base}/events`);
    expect((await memberEvent()).data.events.find((row: { id: number }) => row.id === e.id).notes).toBe(notes);
    const edit = { date: e.date, startTime: e.startTime, endTime: e.endTime, location: e.location };
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, edit)).data.notes).toBe(notes);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, { ...edit, notes: "新备注" })).data.notes).toBe(
      "新备注",
    );
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, { ...edit, notes: "   " })).data.notes).toBe("");
    expect((await createTestEvent(ctx)).notes).toBe("");
  });

  it("rejects excessive notes when creating or editing", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const input = {
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      deadlineDays: 1,
      deadlineHours: 0,
      notes: "字".repeat(1001),
    };
    expect((await ctx.admin.call(`${ctx.base}/events`, input)).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/edit`, input)).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.notes).toBe("");
  });
});
