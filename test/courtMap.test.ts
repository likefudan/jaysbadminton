import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addCourt,
  alignLayout,
  cleanLayout,
  courtMapPlace,
  cropLayout,
  moveStep,
  snapMove,
} from "../src/shared/courtMap";
import { purgeCourtMapHistory, readCourtMapPhotos, rekeyCourtMaps, tendCourtMapPhotos } from "../src/worker/courtMap";
import worker from "../src/worker/index";
import { approveMember, appoint, Client, createTestEvent, GOOGLE, ORIGIN, setUpAdmin } from "./helpers";

const anon = new Client();
const image = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
/** Through the Worker with an AI key and the organizer roles on. GET without a body. */
const AI = { ...env, AZURE_FOUNDRY_API_KEY: "test-key", SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const post = async (path: string, body?: unknown, cookie = "") => {
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    AI,
    {} as ExecutionContext,
  );
  return { status: res.status, data: (await res.json()) as any };
};

/** The reader's run, as its alarm does it; done when no photo is waiting any more. */
async function reader() {
  await readCourtMapPhotos(AI);
  await vi.waitFor(async () => {
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM court_map_photos WHERE state = 'pending'",
    ).first<any>();
    expect(left.n).toBe(0);
  });
}

/** The model answering with `answer`. */
function model(answer: object, seen: any[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    seen.push(JSON.parse(String(init?.body ?? (input as Request).body)));
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-fable-5-1",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 2800, output_tokens: 900 },
    });
  });
  return seen;
}

const court = (label: string, x: number, y: number) => ({ kind: "court", label, x, y, w: 0.1, h: 0.05 });
const plan = {
  found: true,
  aspect: 1.39,
  items: [
    court("2", 0.1, 0.1),
    court("1", 0.3, 0.1),
    court("JR", 0.9, 0.7),
    court("1", 0.5, 0.1),
    { kind: "text", label: "BADMINTON COURTS", x: 0.35, y: 0.25, w: 0.3, h: 0.03 },
    { kind: "area", label: "FRONT DESK", x: 0.7, y: 0.95, w: 0.5, h: 0.2 },
  ],
};

describe("cleanLayout", () => {
  it("keeps courts with numbers, turns other courts into areas, and keeps boxes inside the plan", () => {
    expect(cleanLayout(plan)).toEqual({
      aspect: 1.39,
      items: [
        { kind: "court", label: "2", x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
        { kind: "court", label: "1", x: 0.3, y: 0.1, w: 0.1, h: 0.05 },
        { kind: "area", label: "JR", x: 0.9, y: 0.7, w: 0.1, h: 0.05 },
        { kind: "text", label: "BADMINTON COURTS", x: 0.35, y: 0.25, w: 0.3, h: 0.03 },
        { kind: "area", label: "FRONT DESK", x: 0.7, y: 0.95, w: 0.3, h: 0.05 },
      ],
    });
  });

  it("refuses a plan without courts or with a strange shape", () => {
    expect(cleanLayout({ aspect: 1.3, items: [{ kind: "area", label: "A", x: 0, y: 0, w: 0.1, h: 0.1 }] })).toBeNull();
    expect(cleanLayout({ aspect: 40, items: [court("1", 0, 0)] })).toBeNull();
    expect(cleanLayout("nonsense")).toBeNull();
  });
});

describe("alignment (Ke Li: 不允许随意旋转或者不对齐)", () => {
  const c = (label: string, x: number, y: number, w = 0.1, h = 0.05) => ({ kind: "court" as const, label, x, y, w, h });
  // Two rows of three as a model might read them off a tilted photo: sizes and lines a little off.
  const rough = {
    aspect: 1.4,
    items: [
      c("1", 0.1, 0.1),
      c("2", 0.302, 0.104, 0.104, 0.048),
      c("3", 0.497, 0.097),
      c("4", 0.103, 0.3),
      c("5", 0.3, 0.296, 0.098, 0.052),
      c("6", 0.5, 0.302),
    ],
  };

  it("puts courts read slightly off onto shared rows and columns, all the same size", () => {
    const { items } = alignLayout(rough);
    const uniq = (f: (i: (typeof items)[number]) => number) => [...new Set(items.map(f))].length;
    expect(uniq((i) => i.y)).toBe(2);
    expect(uniq((i) => i.x)).toBe(3);
    expect(uniq((i) => i.w)).toBe(1);
    expect(uniq((i) => i.h)).toBe(1);
    // Doing it again changes nothing, and saving goes through the same step.
    expect(alignLayout({ aspect: 1.4, items })).toEqual({ aspect: 1.4, items });
    expect(cleanLayout(rough)).toEqual({ aspect: 1.4, items });
  });

  it("lets a moved court rest only on the others' lines or half a pitch between them", () => {
    const layout = alignLayout(rough);
    const cols = [...new Set(layout.items.map((i) => i.x))].sort();
    const rows = [...new Set(layout.items.map((i) => i.y))].sort();
    // Dropped a little off court 5's column and row: back on them.
    expect(snapMove(layout, 0, cols[1]! + 0.02, rows[1]! - 0.01)).toEqual({ x: cols[1], y: rows[1] });
    // Dropped between two columns: half a pitch, as an offset row is.
    const half = snapMove(layout, 0, (cols[0]! + cols[1]!) / 2 + 0.01, rows[0]!);
    expect(half.x).toBeCloseTo((cols[0]! + cols[1]!) / 2, 3);
    expect(half.y).toBe(rows[0]);
    // An arrow moves by that half pitch; nothing leaves the plan.
    expect(moveStep(layout, 0).x).toBeCloseTo((cols[1]! - cols[0]!) / 2, 3);
    const edge = snapMove(layout, 0, 5, -3);
    expect(edge.x).toBeLessThanOrEqual(0.9);
    expect(edge.y).toBeGreaterThanOrEqual(0);
  });

  it("adds a court of the same size on the lines, with the first free number, not on top of another", () => {
    const layout = alignLayout(rough);
    const next = addCourt(layout);
    const added = next.items[next.items.length - 1]!;
    expect(added).toMatchObject({ kind: "court", label: "7", w: layout.items[0]!.w, h: layout.items[0]!.h });
    const over = layout.items.some(
      (i) => added.x < i.x + i.w && i.x < added.x + added.w && added.y < i.y + i.h && i.y < added.y + added.h,
    );
    expect(over).toBe(false);
    expect(snapMove(next, next.items.length - 1, added.x, added.y)).toEqual({ x: added.x, y: added.y });
  });

  it("crops to the courts inside a range, redrawn to fill the plan (Ke Li: 只选取一个范围内的场地)", () => {
    // Two rows of three, a label between them and a desk at the bottom right.
    const six = cleanLayout({
      aspect: 2,
      items: [
        ...[0, 1, 2].flatMap((k) => [
          court(String(k + 1), 0.1 + k * 0.2, 0.1),
          court(String(k + 4), 0.1 + k * 0.2, 0.6),
        ]),
        { kind: "text", label: "COURTS", x: 0.3, y: 0.35, w: 0.2, h: 0.05 },
        { kind: "area", label: "DESK", x: 0.8, y: 0.85, w: 0.15, h: 0.1 },
      ],
    })!;
    // A rough range over the left two courts of the top row: it only has to hold their middles.
    const top = cropLayout(six, { x: 0.12, y: 0.08, w: 0.3, h: 0.1 })!;
    expect(top.items.map((i) => i.label)).toEqual(["1", "2"]);
    // Whole courts with the same room all round, still the same shape as drawn and on one row.
    const [a, b] = top.items;
    expect(a!.x).toBeCloseTo(1 - b!.x - b!.w, 3);
    expect(a!.y).toBeCloseTo(1 - a!.y - a!.h, 3);
    expect(a!.y).toBe(b!.y);
    expect((a!.w * top.aspect) / a!.h).toBeCloseTo((0.1 * 2) / 0.05, 1);
    // Labels and other boxes inside come along; a range without a court is refused.
    const left = cropLayout(six, { x: 0, y: 0, w: 0.5, h: 1 })!;
    expect(left.items.map((i) => i.label).sort()).toEqual(["1", "2", "4", "5", "COURTS"]);
    expect(cropLayout(six, { x: 0.75, y: 0.8, w: 0.25, h: 0.2 })).toBeNull();
    // A single court is a plan too, not too long and thin to keep.
    const one = cropLayout(six, { x: 0.1, y: 0.1, w: 0.1, h: 0.05 })!;
    expect(one.items).toHaveLength(1);
    expect(one.aspect).toBeLessThanOrEqual(5);
  });

  it("knows a venue by its address, or by its name when it has none", () => {
    const a = courtMapPlace("Bintang Badminton - Fremont", "48900 Milmont Dr, Fremont, CA 94538");
    expect(courtMapPlace("Bintang", "48900  milmont dr fremont CA 94538 ")).toBe(a);
    expect(courtMapPlace("Bintang Badminton - Fremont", "1 Other St")).not.toBe(a);
    expect(courtMapPlace("Bay Club", "")).toBe(courtMapPlace(" bay  club ", ""));
    expect(courtMapPlace("Bay Club", "")).not.toBe(courtMapPlace("", "Bay Club"));
  });

  it("takes an address written another way for the same venue (Ke Li: Dr 和 Drive 不能当成两家)", () => {
    const a = courtMapPlace("", "48900 Milmont Dr, Fremont, CA 94538");
    for (const other of [
      "48900 Milmont Drive, Fremont, CA 94538, USA",
      "48900 Milmont Dr.",
      "48900 MILMONT DRIVE #100 Fremont",
      "48900 Milmont Dr, Suite B, Fremont, California",
    ])
      expect(courtMapPlace("", other)).toBe(a);
    expect(courtMapPlace("", "48901 Milmont Dr, Fremont")).not.toBe(a);
    expect(courtMapPlace("", "48900 Milmont Ave, Fremont")).not.toBe(a);
    // Directions and other endings both ways; the word after the number is the street's name.
    expect(courtMapPlace("", "1 North First Street, San Jose")).toBe(courtMapPlace("", "1 N First St"));
    expect(courtMapPlace("", "100 Court Street, Oakland")).toBe("a:100 ct st");
    // No ending to go by: the first line, or all of it without the zip and country.
    expect(courtMapPlace("", "1234 El Camino Real, Santa Clara, CA 95050")).toBe(
      courtMapPlace("", "1234 El Camino Real"),
    );
    expect(courtMapPlace("", "Stanford Arrillaga Gym, Stanford, CA 94305, USA")).toBe(
      courtMapPlace("", "Stanford Arrillaga Gym, Stanford, CA"),
    );
  });
});

const ADDRESS = "48900 Milmont Dr, Fremont, CA 94538";
const VENUE = { venue: "Bintang Fremont", address: ADDRESS };

describe("球场图", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Bob runs events (an admin, or an organizer); Alice only plays. Maps are kept in 设置. */
  async function scenario(role: "admin" | "organizer" = "admin") {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { queueRoundMin: 45, location: "Bintang Fremont", address: ADDRESS });
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    for (const m of [alice, bob]) await anon.call(`${m.base}/events/${e.id}/signup`, { friends: [] });
    const cookie = await appoint(bob.id, "bob", role);
    const maps = (path: string, body?: unknown) => post(`${GOOGLE}/court-maps${path}`, body, cookie);
    const shown = async (id = e.id) => (await post(`${alice.base}/events/${id}`)).data.event.queue.map;
    return { ctx, e, alice, bob, maps, shown };
  }

  it("is read from a photo in 设置 by the Owner, admins or organizers, fixed, then saved for the venue's address", async () => {
    const { ctx, e, alice, maps, shown } = await scenario();
    // The event card only shows it: members have nothing to set it with.
    expect(await shown()).toBeNull();
    expect((await post(`${alice.base}/events/${e.id}/queue/map`, { layout: plan })).status).toBe(404);
    expect((await post(`${GOOGLE}/court-maps`, undefined, "")).status).toBe(401);

    // 设置 lists the venues events were held at, none with a plan yet.
    const list = await maps("");
    expect(list.data).toMatchObject({ photo: true, venues: [{ ...VENUE, map: null, updatedAt: null, read: null }] });

    // The photo is taken in at once and read afterwards (Ke Li: 拍了之后可以返回其他页面，过一会儿
    // 回来看结果): until then the venue says who sent it and when, and takes no second one.
    const seen = model(plan);
    expect((await maps("/photo", { ...VENUE, image })).data).toEqual({ ok: true });
    const waiting = (await maps("")).data.venues[0].read;
    expect(waiting).toMatchObject({ state: "pending", by: "Bob", layout: null });
    expect(Date.parse(waiting.at)).toBeGreaterThan(Date.now() - 60_000);
    expect((await maps("/photo", { ...VENUE, image })).data.error.message).toBe(
      "这家球馆有一张照片正在识别，请等它好了再拍",
    );
    await reader();
    const read = (await maps("")).data.venues[0].read;
    expect(read).toMatchObject({ state: "ready", by: "Bob", at: waiting.at });
    expect(read.layout.items.filter((i: any) => i.kind === "court")).toHaveLength(2);
    expect(seen).toHaveLength(1);
    expect(seen[0].messages[0].content.some((c: any) => c.type === "image")).toBe(true);
    // Reading saves nothing, and the photo is gone once it is read.
    expect(await shown()).toBeNull();
    expect((await env.DB.prepare("SELECT image FROM court_map_photos").first<any>()).image).toBeNull();

    // The page sends back what was checked (court 2 renumbered 3); the answer is then put away.
    const checked = {
      ...read.layout,
      items: read.layout.items.map((i: any) => (i.label === "2" ? { ...i, label: "3" } : i)),
    };
    expect((await maps("/save", { ...VENUE, layout: checked, read: true })).status).toBe(200);
    const map = await shown();
    expect(map.items.map((i: any) => i.label)).toEqual(["3", "1", "JR", "BADMINTON COURTS", "FRONT DESK"]);
    // The plan says who saved it and when (Ke Li: 每张图我能知道是谁什么日期和时间添加的).
    const saved = (await maps("")).data.venues;
    expect(saved).toMatchObject([{ ...VENUE, map, savedBy: "Bob", read: null }]);
    expect(Date.parse(saved[0].updatedAt)).toBeGreaterThan(Date.now() - 60_000);
    // The Owner's own 设置 does the same.
    expect((await ctx.admin.call(`${ctx.base}/court-maps`)).data.venues).toHaveLength(1);

    // One plan per venue, by address: another event there shows it whatever the venue is called
    // and however the address is written; the same name with no address doesn't.
    const there = await createTestEvent(ctx, {
      queueRoundMin: 45,
      location: "Bintang",
      address: "48900 milmont drive, Fremont, CA 94538, USA",
    });
    const sameName = await createTestEvent(ctx, { queueRoundMin: 45, location: "Bintang Fremont" });
    for (const id of [there.id, sameName.id]) await anon.call(`${alice.base}/events/${id}/signup`, { friends: [] });
    expect(await shown(there.id)).toEqual(map);
    expect(await shown(sameName.id)).toBeNull();
    // Saved again under the other spelling: still one row, now the newer plan.
    const fewer = { ...map, items: map.items.slice(0, 2) };
    expect(
      (await maps("/save", { venue: "Bintang", address: "48900 Milmont Drive, Fremont", layout: fewer })).status,
    ).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM court_maps").first<{ n: number }>())!.n).toBe(1);
    expect((await shown()).items).toHaveLength(2);
    // The list has the venue once, with its plan, though 最近的场馆 has it under both spellings.
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM locations").first<{ n: number }>())!.n).toBe(2);
    const venues = (await maps("")).data.venues;
    expect(venues.map((v: any) => !!v.map)).toEqual([true]);

    // A layout without courts or a venue isn't saved; 删除 takes it off the venue.
    expect((await maps("/save", { ...VENUE, layout: { aspect: 1, items: [] } })).status).toBe(400);
    expect((await maps("/save", { venue: "", address: "", layout: checked })).status).toBe(400);
    expect((await maps("/remove", VENUE)).status).toBe(200);
    expect(await shown()).toBeNull();
  });

  it("keeps what a save or 删除 replaced for 30 days, the newest 10, to bring back (Ke Li: 防止误操作)", async () => {
    const { maps, shown } = await scenario();
    const layout = (n: number) => ({
      aspect: 1.4,
      items: Array.from({ length: n }, (_, k) => court(String(k + 1), 0.05 + k * 0.07, 0.1)),
    });
    const save = (l: unknown) => maps("/save", { ...VENUE, layout: l });
    const history = async () => (await maps("/history", VENUE)).data.history as any[];
    const courts = (h: any[]) => h.map((o) => o.layout.items.length);

    expect((await save(layout(1))).status).toBe(200);
    expect(await history()).toEqual([]);
    // Saved unchanged: nothing new to keep. Changed: the old one is kept, with who made it.
    await save(layout(1));
    expect(await history()).toEqual([]);
    await save(layout(2));
    expect(await history()).toMatchObject([{ savedBy: "Bob", layout: { items: [{ label: "1" }] } }]);
    // 删除 by mistake: the plan removed is there to restore.
    await maps("/remove", VENUE);
    expect(await shown()).toBeNull();
    expect(courts(await history())).toEqual([2, 1]);
    await save((await history())[0].layout);
    expect((await shown()).items).toHaveLength(2);

    // Only the newest 10 stay.
    for (let n = 3; n <= 13; n++) await save(layout(n));
    expect(courts(await history())).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    // After 30 days they go: from the list, at the next save, and in the nightly job.
    await env.DB.prepare(
      "UPDATE court_map_history SET replaced_at = ? WHERE id IN (SELECT id FROM court_map_history ORDER BY id LIMIT 8)",
    )
      .bind(new Date(Date.now() - 31 * 24 * 3600_000).toISOString())
      .run();
    expect(courts(await history())).toEqual([12, 11]);
    await purgeCourtMapHistory(env);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM court_map_history").first<{ n: number }>())!.n).toBe(2);
  });

  it("lets an organizer draw and change it by hand; 拍照 is for the Owner and admins (Ke Li)", async () => {
    const { maps, shown } = await scenario("organizer");
    expect((await maps("")).data.photo).toBe(false);
    model(plan);
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(403);
    const layout = { aspect: 1.4, items: [court("1", 0.1, 0.1)] };
    expect((await maps("/save", { ...VENUE, layout })).status).toBe(200);
    expect((await shown()).items).toHaveLength(1);
  });

  it("writes every photo read into 群操作记录 with its cost, ten a month a venue and ten each", async () => {
    const { ctx, maps } = await scenario();
    // group_audit outlives a test: only what this one adds.
    const all = async () =>
      (
        await env.DB.prepare("SELECT detail FROM group_audit WHERE detail LIKE '拍照识别%' ORDER BY id").all()
      ).results.map((r) => r.detail);
    const before = (await all()).length;
    const audit = async () => (await all()).slice(before);
    // Read: 2800 tokens in and 900 out on the model's price.
    model(plan);
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(200);
    expect(await audit()).toEqual([]);
    await reader();
    expect(await audit()).toEqual([
      expect.stringMatching(/^拍照识别「Bintang Fremont」的球场图，费用估算 \$\d+\.\d\d，这家球馆本月第 1 张$/),
    ]);
    // Asked with care, whatever 设置 has for 拍照登记.
    const seen = model({ found: false, aspect: 1, items: [] });
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(200);
    await reader();
    expect((await maps("")).data.venues[0].read).toMatchObject({ state: "none", by: "Bob", layout: null });
    expect(seen[0].output_config.effort).toBe("high");
    // 知道了 puts it away.
    expect((await maps("/photo/drop", VENUE)).status).toBe(200);
    expect((await maps("")).data.venues[0].read).toBeNull();
    expect((await audit())[1]).toContain("（没有识别出来）");
    expect((await audit())[1]).toContain("本月第 2 张");
    const rows = await env.DB.prepare("SELECT ok, cost, state FROM court_map_photos ORDER BY id").all<any>();
    expect(rows.results.map((r) => [r.ok, r.state])).toEqual([
      [1, "done"],
      [0, "done"],
    ]);
    expect(rows.results[0].cost).toBeGreaterThan(0);

    // The same venue under another spelling counts with it: ten a month, then no more this month.
    const drive = { venue: "Bintang", address: "48900 Milmont Drive, Fremont" };
    model(plan);
    for (let n = 3; n <= 10; n++) {
      expect((await maps("/photo", { ...drive, image })).status).toBe(200);
      await reader();
    }
    const full = await maps("/photo", { ...VENUE, image });
    expect(full.status).toBe(400);
    expect(full.data.error.message).toBe("这家球馆这个月已经拍了 10 张，请下个月再拍");
    // Bob has sent his ten too, so not at another venue either; the Owner still can there.
    const other = { venue: "Synergy", address: "1 Other St" };
    const mine = await maps("/photo", { ...other, image });
    expect(mine.data.error.message).toBe("你这个月已经拍了 10 张，请下个月再拍");
    expect((await post(`${ctx.base}/court-maps/photo`, { ...other, image }, ctx.admin.cookie)).status).toBe(200);
    await reader();
    expect(await audit()).toHaveLength(11);
    // Next month both counts start again.
    await env.DB.prepare("UPDATE court_map_photos SET month = '2026-01'").run();
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(200);

    // The model didn't answer: said so on the venue, and in 群操作记录. One the reader took and
    // never finished is given up by the cron after ten minutes.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 500 }));
    await reader();
    expect((await maps("")).data.venues[0].read).toMatchObject({ state: "failed" });
    expect((await audit()).at(-1)).toContain("（没有识别出来）");
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(200);
    await env.DB.prepare("UPDATE court_map_photos SET started_at = ? WHERE state = 'pending'")
      .bind(new Date(Date.now() - 11 * 60_000).toISOString())
      .run();
    await tendCourtMapPhotos(AI);
    const stuck = await env.DB.prepare("SELECT state, image FROM court_map_photos ORDER BY id DESC").first<any>();
    expect(stuck).toEqual({ state: "failed", image: null });
    expect(await audit()).toHaveLength(13);
  });

  it("has the reader woken off the request, on a PushSender of its own", async () => {
    const { maps } = await scenario();
    model(plan);
    expect((await maps("/photo", { ...VENUE, image })).status).toBe(200);
    const stub = env.PUSH.get(env.PUSH.idFromName("court-map"));
    await runInDurableObject(stub, async (sender, state) => {
      expect(await state.storage.get("maps")).toBe(true);
      // Its alarm, with the model's key as the deployed Worker has it.
      (sender as unknown as { env: unknown }).env = AI;
      await sender.alarm!();
    });
    expect((await maps("")).data.venues[0].read).toMatchObject({ state: "ready" });
  });

  it("moves plans kept under an address as it used to be told apart to where it is now, with their history", async () => {
    const { maps, shown } = await scenario();
    const layout = JSON.stringify({ aspect: 1.4, items: [court("1", 0.1, 0.1)] });
    const old = "a:48900 milmont dr fremont ca 94538";
    await env.DB.prepare(
      "INSERT INTO court_maps (place, venue, address, layout, updated_by, updated_at) VALUES (?, ?, ?, ?, '', ?)",
    )
      .bind(old, VENUE.venue, ADDRESS, layout, "2026-11-15T00:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO court_map_history (place, layout, updated_by, updated_at, replaced_at) VALUES (?, ?, '', ?, ?)",
    )
      .bind(old, layout, "2026-11-14T00:00:00.000Z", new Date().toISOString())
      .run();
    expect(await shown()).toBeNull();
    await rekeyCourtMaps(env);
    expect((await shown()).items).toHaveLength(1);
    expect((await maps("/history", VENUE)).data.history).toHaveLength(1);

    // Two rows that are one venue now: the one saved last stays, the other joins 以前的图.
    const two = JSON.stringify({ aspect: 1.4, items: [court("1", 0.1, 0.1), court("2", 0.3, 0.1)] });
    await env.DB.prepare(
      "INSERT INTO court_maps (place, venue, address, layout, updated_by, updated_at) VALUES (?, ?, ?, ?, '', ?)",
    )
      .bind("a:old spelling", "Bintang", "48900 Milmont Drive, Fremont", two, "2026-11-15T01:00:00.000Z")
      .run();
    await rekeyCourtMaps(env);
    expect((await shown()).items).toHaveLength(2);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM court_maps").first<{ n: number }>())!.n).toBe(1);
    expect((await maps("/history", VENUE)).data.history).toHaveLength(2);
  });
});
