import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/worker/index";
import { describe, expect, it } from "vitest";
import { Client, approveMember, createTestEvent, futureDate, setUpAdmin } from "./helpers";

const anon = new Client();
const expire = (id: number) =>
  env.DB.prepare("UPDATE events SET deadline_at = ? WHERE id = ?").bind(new Date(Date.now() - 60_000).toISOString(), id).run();

describe("creating events", () => {
  it("computes the deadline from the offset and assigns date codes", async () => {
    const ctx = await setUpAdmin();
    const date = futureDate(7);
    const e = await createTestEvent(ctx, { date, deadlineDays: 1, deadlineHours: 2 });
    expect(e.code).toBe(date.slice(5, 7) + date.slice(8));
    expect(Date.parse(e.deadlineAt)).toBe(Date.parse(`${date}T19:00:00-07:00`) - 26 * 3600_000 + (date >= "2026-11-01" ? 3600_000 : 0));
    const second = await createTestEvent(ctx, { date });
    expect(second.code).toBe(e.code + "B");
  });

  it("remembers the last times, location and deadline offset as defaults", async () => {
    const ctx = await setUpAdmin();
    await createTestEvent(ctx, { startTime: "20:00", endTime: "22:30", location: "Wellness Gym", deadlineDays: 2, deadlineHours: 6 });
    const { data } = await ctx.admin.call(`${ctx.base}/events/defaults`);
    expect(data).toMatchObject({ startTime: "20:00", endTime: "22:30", location: "Wellness Gym", deadlineDays: 2, deadlineHours: 6 });
    expect(data.locations).toEqual(["Wellness Gym"]);
  });

  it("refuses a deadline that is already in the past", async () => {
    const ctx = await setUpAdmin();
    const res = await ctx.admin.call(`${ctx.base}/events`, {
      date: futureDate(1), startTime: "19:00", endTime: "21:00", location: "X", deadlineDays: 3, deadlineHours: 0,
    });
    expect(res.data.error.message).toBe("按这个提前量算出的截止时间已经过了，请调整");
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

    const pub = (await anon.call(`/api/public/events/${e.code}`)).data;
    expect(pub.roster.map((r: { name: string }) => r.name)).toEqual(["Alice", "Tom", "Alice的朋友2"]);

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

  it("locks members out after the deadline, until the Owner reopens", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const carol = await approveMember(ctx, "Carol");
    await expire(e.id);

    const late = await anon.call(`${carol.base}/events/${e.id}/signup`, { friends: [] });
    expect(late.data.error.message).toBe("报名已截止，不能再修改");
    const listed = (await anon.call(`${carol.base}/events`)).data.events[0];
    expect(listed).toMatchObject({ status: "closed", canEdit: false });

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
      memberId: owner, includeSelf: false, friends: ["路人甲", "", "", "", ""],
    });
    expect(res.status).toBe(200); // walk-ins ignore the friend cap
    expect(res.data.roster.map((r: { name: string }) => r.name)).toEqual(["路人甲", "Jay的朋友2", "Jay的朋友3", "Jay的朋友4", "Jay的朋友5"]);
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
    d = (await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: eve.id, includeSelf: true, friends: [] })).data;
    expect(d.roster.map((r: { name: string }) => r.name)).toEqual(["小李", "Eve"]);

    const dup = await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: eve.id, includeSelf: true, friends: [] });
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
    const add = await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: owner, includeSelf: true, friends: [] });
    expect(add.data.error.message).toBe("这个活动已取消");
  });

  it("deactivating a member drops their sign-up on open events only", async () => {
    const ctx = await setUpAdmin();
    const open = await createTestEvent(ctx);
    const closed = await createTestEvent(ctx);
    const fay = await approveMember(ctx, "Fay");
    await anon.call(`${fay.base}/events/${open.id}/signup`, { friends: [] });
    await anon.call(`${fay.base}/events/${closed.id}/signup`, { friends: [] });
    await expire(closed.id);
    await anon.call("/api/public/home"); // closes the expired event
    await ctx.admin.call(`${ctx.base}/members/${fay.id}/deactivate`, {});
    expect((await ctx.admin.call(`${ctx.base}/events/${open.id}`)).data.headcount).toBe(0);
    expect((await ctx.admin.call(`${ctx.base}/events/${closed.id}`)).data.headcount).toBe(1);
  });
});
