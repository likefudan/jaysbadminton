import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
import { SHORTCUT_INSTALL_URL, SHORTCUT_VERSION } from "../src/shared/calories";
import { shortcutOutdated, timeWindow } from "../src/worker/calories";
import { Client, ORIGIN, approveMember, createTestEvent, setUpAdmin } from "./helpers";

const anon = new Client();
const today = toPacific(new Date()).date;

/** Moves the event's start `hoursAgo` into the past (and the deadline before it). */
const startedAgo = (id: number, hoursAgo: number) =>
  env.DB.prepare("UPDATE events SET start_at = ?, end_at = ?, deadline_at = ?, status = 'closed' WHERE id = ?")
    .bind(
      new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
      new Date(Date.now() - (hoursAgo - 2) * 3600_000).toISOString(),
      new Date(Date.now() - (hoursAgo + 1) * 3600_000).toISOString(),
      id,
    )
    .run();

const upload = (url: string, kcal: unknown) => anon.call(url.replace(ORIGIN, ""), { kcal });

async function scene() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const e = await createTestEvent(ctx);
  await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: ["Tom"] });
  return { ctx, alice, bob, e };
}

const card = async (base: string, id: number) => (await anon.call(`${base}/events/${id}`)).data.event;

describe("卡路里", () => {
  it("hands the Shortcut Pacific start and end times, from 10 minutes before for the warm-up", () => {
    expect(timeWindow({ start_at: "2026-05-27T03:30:00.000Z", end_at: "2026-05-27T06:00:00.000Z" })).toEqual({
      start: "2026-05-26 20:20",
      end: "2026-05-26 23:00",
    });
    expect(timeWindow({ start_at: "2026-05-27T07:05:00.000Z", end_at: "2026-05-27T08:30:00.000Z" })).toEqual({
      start: "2026-05-26 23:55",
      end: "2026-05-27 01:30",
    });
  });

  it("remembers the Shortcut version each upload came with, and asks only those behind to update", async () => {
    expect(shortcutOutdated(null, 2)).toBe(false);
    expect(shortcutOutdated(1, 2)).toBe(true);
    expect(shortcutOutdated(2, 2)).toBe(false);
    const { alice, e } = await scene();
    await startedAgo(e.id, 1);
    const version = async () =>
      (await env.DB.prepare("SELECT calorie_shortcut_v AS v FROM members WHERE id = ?").bind(alice.id).first())!.v;
    expect(await version()).toBeNull();
    expect(await card(alice.base, e.id)).toMatchObject({ kcalUpdate: false });
    const first = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    await upload(first.upload, 400);
    expect(await version()).toBe(1);
    const next = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    await anon.call(next.upload.replace(ORIGIN, ""), { kcal: 410, v: 2 });
    expect(await version()).toBe(2);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: 410, kcalUpdate: false });
  });

  it("takes the Shortcut link and version from 设置, so a new one needs no deploy", async () => {
    const { ctx, alice, e } = await scene();
    await startedAgo(e.id, 1);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.calorieShortcut).toEqual({
      url: SHORTCUT_INSTALL_URL,
      version: SHORTCUT_VERSION,
    });
    expect(await card(alice.base, e.id)).toMatchObject({ kcalInstall: SHORTCUT_INSTALL_URL });
    // 个人信息 always offers the install link, also before any event can be read.
    const mine = async () => (await anon.call(`${alice.base}/calories`)).data.shortcut;
    expect(await mine()).toEqual({ url: SHORTCUT_INSTALL_URL, outdated: false });
    const next = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    await anon.call(next.upload.replace(ORIGIN, ""), { kcal: 410, v: SHORTCUT_VERSION });

    const url = `https://www.icloud.com/shortcuts/${"a".repeat(32)}`;
    const set = (calorieShortcut: unknown) => ctx.admin.call(`${ctx.base}/settings`, { calorieShortcut });
    expect((await set({ url: "https://example.com/x", version: 3 })).status).toBe(400);
    expect((await set({ url, version: 0 })).status).toBe(400);
    expect((await set({ url, version: SHORTCUT_VERSION + 1 })).status).toBe(200);
    expect(await card(alice.base, e.id)).toMatchObject({ kcalInstall: url, kcalUpdate: true });
    expect(await mine()).toEqual({ url, outdated: true });
    // Not offered 读取, no link.
    expect(await card(alice.base, (await createTestEvent(ctx)).id)).toMatchObject({ kcalInstall: "" });
  });

  it("reads only once the event has started, with a one-time link the Shortcut posts to", async () => {
    const { alice, e } = await scene();
    expect((await anon.call(`${alice.base}/events/${e.id}/calories`, {})).status).toBe(400);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: null, kcalOpen: false });

    await startedAgo(e.id, 1);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: null, kcalOpen: true });
    const { status, data } = await anon.call(`${alice.base}/events/${e.id}/calories`, {});
    expect(status).toBe(200);
    const row = await env.DB.prepare("SELECT start_at, end_at FROM events WHERE id = ?").bind(e.id).first();
    const at = (iso: unknown) => toPacific(String(iso));
    const end = at(row!.end_at);
    expect(data).toMatchObject({
      start: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/),
      end: `${end.date} ${end.time}`,
    });
    expect(data.upload).toMatch(new RegExp(`^${ORIGIN}/api/calories/[\\w-]{43}$`));

    // The Shortcut sends a number (a string too); the link works once.
    expect((await upload(data.upload, 431.6)).data).toEqual({ ok: true, kcal: 432 });
    expect((await upload(data.upload, 500)).status).toBe(403);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: 432 });

    // 重新读取 overwrites.
    const again = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    expect((await upload(again.upload, "388 kcal")).data.kcal).toBe(388);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: 388 });

    // 0 means nothing in 「健康」 (no Apple Watch): the number read before stays.
    const none = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    expect((await upload(none.upload, 0)).data).toEqual({ ok: true, kcal: 0 });
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: 388 });
  });

  it("refuses people not on it, and after 30 days", async () => {
    const { alice, bob, e } = await scene();
    await startedAgo(e.id, 1);
    expect((await anon.call(`${bob.base}/events/${e.id}/calories`, {})).status).toBe(400);
    await startedAgo(e.id, 31 * 24);
    expect((await anon.call(`${alice.base}/events/${e.id}/calories`, {})).status).toBe(400);
    expect(await card(alice.base, e.id)).toMatchObject({ kcalOpen: false });
  });

  it("stays open as many days as 设置 says", async () => {
    const { ctx, alice, e } = await scene();
    await startedAgo(e.id, 40 * 24);
    expect((await ctx.admin.call(`${ctx.base}/settings`, { calorieReadDays: 60 })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.calorieReadDays).toBe(60);
    expect(await card(alice.base, e.id)).toMatchObject({ kcalOpen: true });
    expect((await anon.call(`${alice.base}/events/${e.id}/calories`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`, { calorieReadDays: 0 })).status).toBe(400);
  });

  it("rejects numbers out of range and expired links, using the link up either way", async () => {
    const { alice, e } = await scene();
    await startedAgo(e.id, 1);
    const first = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    expect((await upload(first.upload, 99999)).status).toBe(400);
    expect((await upload(first.upload, 400)).status).toBe(403);
    const late = (await anon.call(`${alice.base}/events/${e.id}/calories`, {})).data;
    await env.DB.prepare("UPDATE calorie_uploads SET expires_at = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await upload(late.upload, 400)).status).toBe(403);
    expect(await card(alice.base, e.id)).toMatchObject({ kcal: null });
  });

  it("shows the totals on 个人信息 and puts only members who join on the 卡路里榜", async () => {
    const { ctx, alice, bob, e } = await scene();
    const e2 = await createTestEvent(ctx, { startTime: "20:00", endTime: "22:00" });
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    await anon.call(`${alice.base}/events/${e2.id}/signup`, { friends: [] });
    await startedAgo(e.id, 3);
    await startedAgo(e2.id, 1);
    const read = async (base: string, id: number, kcal: number) =>
      upload((await anon.call(`${base}/events/${id}/calories`, {})).data.upload, kcal);
    await read(alice.base, e.id, 400);
    await read(alice.base, e2.id, 300);
    await read(bob.base, e.id, 500);
    await env.DB.prepare("UPDATE events SET date = ? WHERE id IN (?, ?)").bind(today, e.id, e2.id).run();

    const mine = (await anon.call(`${alice.base}/calories`)).data;
    expect(mine).toMatchObject({ yearKcal: 700, yearCount: 2, board: false });
    expect(mine.events.map((x: { kcal: number }) => x.kcal)).toEqual([300, 400]);

    const board = async () => (await anon.call("/api/public/home")).data.leaderboard.calories;
    await anon.call(`${alice.base}/calories/board`, { on: true });
    // The same total as 我的卡路里, before the event is settled too; a cancelled event drops out.
    expect(await board()).toEqual([{ rank: 1, name: "Alice", value: 700 }]);
    await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e2.id).run();
    expect(await board()).toEqual([{ rank: 1, name: "Alice", value: 400 }]);
    await env.DB.prepare("UPDATE events SET status = 'settled' WHERE id IN (?, ?)").bind(e.id, e2.id).run();
    expect(await board()).toEqual([{ rank: 1, name: "Alice", value: 700 }]);
    await anon.call(`${bob.base}/calories/board`, { on: true });
    expect(await board()).toEqual([
      { rank: 1, name: "Alice", value: 700 },
      { rank: 2, name: "Bob", value: 500 },
    ]);
    // Marked absent: off the board for that event.
    await env.DB.prepare("UPDATE registrations SET attended = 0 WHERE event_id = ? AND member_id = ?")
      .bind(e2.id, alice.id)
      .run();
    expect((await board())[0]).toEqual({ rank: 1, name: "Bob", value: 500 });
    await anon.call(`${bob.base}/calories/board`, { on: false });
    expect(await board()).toEqual([{ rank: 1, name: "Alice", value: 400 }]);

    // 已结清 shows it too.
    const { history } = (await anon.call(`${bob.base}/events`)).data;
    expect(history.find((h: { id: number }) => h.id === e.id)?.kcal).toBe(500);

    // Deleting one event, then everything: gone from 我的卡路里 and the board, others' stay.
    const code = (await env.DB.prepare("SELECT code FROM events WHERE id = ?").bind(e.id).first<{ code: string }>())!
      .code;
    expect((await anon.call(`${alice.base}/calories/delete`, {})).status).toBe(400);
    await anon.call(`${alice.base}/calories/delete`, { code });
    expect((await anon.call(`${alice.base}/calories`)).data).toMatchObject({ yearKcal: 300, yearCount: 1 });
    await anon.call(`${alice.base}/calories/delete`, { all: true });
    expect((await anon.call(`${alice.base}/calories`)).data).toMatchObject({ yearKcal: 0, events: [], board: true });
    expect(await board()).toEqual([]);
    expect((await anon.call(`${bob.base}/calories`)).data.yearKcal).toBe(500);
  });
});
