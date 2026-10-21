import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { courtPhase, parseAccountList, queueWait } from "../src/shared/courtQueue";
import { purgeCourtPhotos, toPhotoResult } from "../src/worker/courtPhoto";
import worker from "../src/worker/index";
import { Client, ORIGIN, approveMember, createTestEvent, setUpAdmin } from "./helpers";

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

  it("reads a pasted account list from the first numbered line, exactly as typed", () => {
    const text = [
      "#Group Note",
      "Sunday group password",
      "",
      "1. Alice cat12",
      "2. bob Dog7",
      "3、龙小明 tiger5",
      "4. ALICE again",
      "5. justaname",
      "",
      "6.Coco  moon 9",
      "7) Dana sun3",
    ].join("\r\n");
    expect(parseAccountList(text)).toEqual({
      accounts: [
        { username: "Alice", password: "cat12" },
        { username: "bob", password: "Dog7" },
        { username: "龙小明", password: "tiger5" },
        { username: "Dana", password: "sun3" },
      ],
      bad: ["5. justaname", "6.Coco  moon 9"],
    });
    expect(parseAccountList("no numbers here\nat all")).toEqual({ accounts: [], bad: [] });
  });

  it("批量添加 skips accounts already on the event (any case) and keeps the cap", async () => {
    const { alice, bob, q, card, e } = await scenario();
    await anon.call(`${alice.base}${q}/accounts`, { username: "Mark", password: "1357" });
    const r = await anon.call(`${alice.base}${q}/accounts/batch`, {
      accounts: [
        { username: "mark", password: "new" },
        { username: "Coco", password: "2468" },
        { username: "龙小明", password: "x1" },
      ],
    });
    expect(r.data).toEqual({ added: 2, skipped: ["mark"] });
    const accounts = (await card(alice.base))!.queue.accounts as { username: string; password: string }[];
    expect(accounts.map((a) => [a.username, a.password]).sort()).toEqual([
      ["Coco", "2468"],
      ["Mark", "1357"],
      ["龙小明", "x1"],
    ]);
    expect((await anon.call(`${alice.base}${q}/accounts/batch`, { accounts: [] })).status).toBe(400);
    const many = Array.from({ length: 98 }, (_, i) => ({ username: `u${i}`, password: "p" }));
    const over = await anon.call(`${alice.base}${q}/accounts/batch`, { accounts: many });
    expect(over.status).toBe(400);
    expect(over.data.error.message).toBe("每场最多 100 个账号，现在已有 3 个");
    // Only people on the event can add.
    expect((await anon.call(`${bob.base}/events/${e.id}/queue/accounts/batch`, { accounts: many })).status).toBe(400);
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

describe("拍照登记", () => {
  afterEach(() => vi.restoreAllMocks());

  // A tiny JPEG header is all the check looks at; the model's answer is stubbed.
  const image = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
  const withKey = (path: string, body: unknown) =>
    worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { ...env, ANTHROPIC_API_KEY: "test-key" },
      {} as ExecutionContext,
    );
  /** The Claude API answering with `ours` (and checking what it was sent). */
  function model(answer: object, seen: any[] = []) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!String(input instanceof Request ? input.url : input).startsWith("https://api.anthropic.com/"))
        throw new Error(String(input));
      seen.push(JSON.parse(String(init?.body ?? (input as Request).body)));
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2800, output_tokens: 300 },
      });
    });
    return seen;
  }

  it("is hidden and refused while the site has no key", async () => {
    const { alice, q, card } = await scenario();
    await anon.call(`${alice.base}${q}/accounts`, { username: "Peggy", password: "1" });
    expect((await card(alice.base))!.queue.photo).toBe(false);
    const res = await anon.call(`${alice.base}${q}/photo`, { image });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toBe("拍照登记还没有开通，请手动填写");
  });

  it("reads our courts off the photo for the form, and keeps the photo", async () => {
    const { alice, bob, e, q } = await scenario();
    for (const username of ["Peggy", "Jayx", "Wenxi", "Orianne"])
      await anon.call(`${alice.base}${q}/accounts`, { username, password: "1" });
    const seen = model({
      ours: [
        {
          court: 2,
          minutes_left: 7,
          status: "playing",
          queue_position: null,
          accounts: [
            { name: "peggy", uncertain: false },
            { name: "Jayx", uncertain: false },
            { name: "Stranger", uncertain: false },
          ],
        },
        {
          court: 12,
          minutes_left: 12,
          status: "queue",
          queue_position: 1,
          accounts: [{ name: "Wenxi", uncertain: true }],
        },
        {
          court: 99,
          minutes_left: null,
          status: "queue",
          queue_position: 7,
          accounts: [{ name: "Orianne", uncertain: false }],
        },
      ],
      unreadable_courts: [15, 3, 3],
    });
    const res = await withKey(`${alice.base}${q}/photo`, { image });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      courts: [
        {
          court: 2,
          position: 0,
          minutesLeft: 7,
          accounts: [
            { username: "Peggy", uncertain: false },
            { username: "Jayx", uncertain: false },
          ],
        },
        { court: 12, position: 1, minutesLeft: 12, accounts: [{ username: "Wenxi", uncertain: true }] },
      ],
      unreadable: [3, 15],
    });
    // Sonnet at low effort, told our accounts, sent the photo as JPEG.
    expect(seen[0].model).toBe("claude-sonnet-5-5");
    expect(seen[0].output_config.effort).toBe("low");
    expect(seen[0].messages[0].content[0].source).toMatchObject({ media_type: "image/jpeg", data: image });
    expect(seen[0].messages[0].content[1].text).toContain("Peggy, Jayx, Wenxi, Orianne");
    // Nothing is saved as a court; the photo and what was read are kept.
    const kept = await env.DB.prepare("SELECT result FROM queue_photos WHERE event_id = ?")
      .bind(e.id)
      .all<{ result: string }>();
    expect(kept.results).toHaveLength(1);
    expect(JSON.parse(kept.results[0]!.result).courts).toHaveLength(2);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM queue_courts WHERE event_id = ?")
          .bind(e.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);

    // Only players on the event; not a non-JPEG.
    expect((await withKey(`${bob.base}${q}/photo`, { image })).status).toBe(400);
    expect((await withKey(`${alice.base}${q}/photo`, { image: btoa("GIF89a") })).status).toBe(400);
  });

  it("says so when the model fails, and needs accounts first", async () => {
    const { alice, q } = await scenario();
    expect((await withKey(`${alice.base}${q}/photo`, { image })).status).toBe(400);
    await anon.call(`${alice.base}${q}/accounts`, { username: "Peggy", password: "1" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 }),
    );
    const res = await withKey(`${alice.base}${q}/photo`, { image });
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error.message).toBe("照片没有识别出来，请重拍一张或手动填写");
  });

  it("forgets photos after 7 days", async () => {
    const { e, alice } = await scenario();
    const member = alice.id;
    const put = (iso: string) =>
      env.DB.prepare("INSERT INTO queue_photos (event_id, member_id, image, created_at) VALUES (?, ?, ?, ?)")
        .bind(e.id, member, new Uint8Array([0xff, 0xd8]), iso)
        .run();
    const now = new Date("2026-10-20T12:00:00Z");
    await put("2026-10-13T11:00:00Z");
    await put("2026-10-14T12:00:00Z");
    await purgeCourtPhotos(env, now);
    const left = await env.DB.prepare("SELECT created_at FROM queue_photos WHERE event_id = ?").bind(e.id).all();
    expect(left.results.map((r: any) => r.created_at)).toEqual(["2026-10-14T12:00:00Z"]);
  });

  it("keeps only our accounts, a group at most, one entry per court and place", () => {
    const r = toPhotoResult(
      {
        ours: [
          {
            court: 5,
            minutes_left: 900,
            status: "playing",
            queue_position: null,
            accounts: [
              { name: "A", uncertain: false },
              { name: "b", uncertain: true },
              { name: "C", uncertain: false },
              { name: "D", uncertain: false },
              { name: "E", uncertain: false },
            ],
          },
          {
            court: 5,
            minutes_left: 9,
            status: "playing",
            queue_position: null,
            accounts: [{ name: "a", uncertain: false }],
          },
          {
            court: 0,
            minutes_left: 9,
            status: "playing",
            queue_position: null,
            accounts: [{ name: "A", uncertain: false }],
          },
          {
            court: 6,
            minutes_left: 9,
            status: "queue",
            queue_position: null,
            accounts: [{ name: "A", uncertain: false }],
          },
        ],
        unreadable_courts: "nope",
      },
      ["A", "B", "C", "D", "E"],
    );
    expect(r).toEqual({
      courts: [
        {
          court: 5,
          position: 0,
          minutesLeft: null,
          accounts: [
            { username: "A", uncertain: false },
            { username: "B", uncertain: true },
            { username: "C", uncertain: false },
            { username: "D", uncertain: false },
          ],
        },
      ],
      unreadable: [],
    });
    expect(toPhotoResult(null, ["A"])).toEqual({ courts: [], unreadable: [] });
  });
});
