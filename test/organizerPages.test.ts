import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ROLE_CAPABILITIES } from "../src/worker/organizers";
import {
  appoint,
  approveMember,
  Client,
  createTestEvent,
  expire,
  futureDate,
  GOOGLE,
  googleCookie,
  request,
  setUpAdmin,
  tokenOf,
} from "./helpers";

/** Card 6: what the admin pages and the member pages show an organizer, and what they leave out. */

const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });
const get = async (path: string, cookie: string, organizers = "1") =>
  json(await request(path, cookie, undefined, organizers));

const newEvent = async (cookie: string, location: string, days = 8) =>
  json(
    await request(`${GOOGLE}/events`, cookie, {
      date: futureDate(days),
      startTime: "18:30",
      endTime: "20:30",
      location,
      deadlineDays: 2,
      deadlineHours: 0,
    }),
  );

/** The Owner, Alice (an organizer with her Venmo filled in) and Bob, with one event each. */
async function scenario() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const org = await appoint(alice.id, "alice");
  expect(
    (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" }))
      .status,
  ).toBe(200);
  const owner = (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;
  const theirs = await createTestEvent(ctx);
  const mine = await newEvent(org, "Alice Gym");
  expect(mine.status).toBe(200);
  return { ctx, alice, bob, org, owner, theirs: theirs.id as number, mine: mine.data.id as number };
}

describe("the admin pages for an organizer", () => {
  it("tells the page who is looking", async () => {
    const { ctx, org, alice, owner } = await scenario();
    expect((await get(`${GOOGLE}/members`, org)).data.viewer).toEqual({
      id: alice.id,
      role: "organizer",
      caps: [...ROLE_CAPABILITIES.organizer],
    });
    expect((await ctx.admin.call(`${ctx.base}/members`)).data.viewer).toEqual({
      id: owner,
      role: "owner",
      caps: [...ROLE_CAPABILITIES.owner],
    });
  });

  it("never returns a member's personal link to an organizer", async () => {
    const { ctx, org, alice, bob, mine } = await scenario();
    await new Client().call(`${bob.base}/events/${mine}/signup`, { friends: ["Tom"] });
    await expire(mine);
    expect(
      (
        await request(`${GOOGLE}/events/${mine}/finalize`, org, {
          courtTotal: "40",
          shuttleCount: 2,
          shuttlePrice: "3",
        })
      ).status,
    ).toBe(200);
    // The members' link tokens (Alice's own too).
    const tokens = [tokenOf(bob.base), tokenOf(alice.base)];
    const pages = [
      "/members",
      `/members/${bob.id}/profile`,
      `/members/${alice.id}/profile`,
      "/events",
      `/events/${mine}`,
      `/events/${mine}/settlement`,
      "/events/defaults",
      "/inbound",
      "/payment-profile",
      "/organizer/retire",
    ];
    for (const page of pages) {
      const { status, data } = await get(`${GOOGLE}${page}`, org);
      expect(status, page).toBe(200);
      const body = JSON.stringify(data);
      expect(body, page).not.toMatch(/\/m\/[A-Za-z0-9_-]{8,}/);
      for (const t of tokens) expect(body, page).not.toContain(t);
    }
    // The Owner's own members list carries none either (links come from 链接, one at a time).
    expect(JSON.stringify((await ctx.admin.call(`${ctx.base}/members`)).data)).not.toContain(tokenOf(bob.base));
  });

  it("lists only the organizer's own events; the Owner sees all, with who runs each, and filters by it", async () => {
    const { ctx, org, alice, owner, theirs, mine } = await scenario();
    const ids = (d: any) => d.current.map((e: { id: number }) => e.id);
    const own = (await get(`${GOOGLE}/events`, org)).data;
    expect(ids(own)).toEqual([mine]);
    expect(own.current[0].manager).toEqual({ id: alice.id, name: "Alice" });
    // An organizer can't ask for someone else's list.
    expect(ids((await get(`${GOOGLE}/events?manager=${owner}`, org)).data)).toEqual([mine]);

    const all = (await get(`${ctx.base}/events`, ctx.admin.cookie)).data;
    expect(ids(all).sort()).toEqual([theirs, mine].sort());
    expect(all.current.find((e: { id: number }) => e.id === theirs).manager).toEqual({ id: owner, name: "Jay" });
    expect(ids((await ctx.admin.call(`${ctx.base}/events?manager=${alice.id}`)).data)).toEqual([mine]);
    // Everyone who has run an event, for the filter (organizers get none: they can't filter).
    expect(all.managers).toEqual(expect.arrayContaining([{ id: alice.id, name: "Alice" }]));
    // With the feature off the filter is not shown, so the list is not worked out.
    expect((await ctx.admin.call(`${ctx.base}/events`)).data.managers).toEqual([]);
    expect(own.managers).toEqual([]);
    // The Owner's own include events from before 0023 (manager_id NULL).
    await env.DB.prepare("UPDATE events SET manager_id = NULL, payee_id = NULL WHERE id = ?").bind(theirs).run();
    expect(ids((await ctx.admin.call(`${ctx.base}/events?manager=${owner}`)).data)).toEqual([theirs]);
  });

  it("remembers 新建活动 and shuttle price defaults per person, starting from the Owner's", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const org = await appoint(alice.id, "alice");
    await createTestEvent(ctx, { startTime: "19:30", endTime: "21:30", location: "Owner Hall" });
    // Nothing of her own yet: the Owner's.
    expect((await get(`${GOOGLE}/events/defaults`, org)).data).toMatchObject({
      startTime: "19:30",
      location: "Owner Hall",
    });

    await newEvent(org, "Alice Gym");
    expect((await get(`${GOOGLE}/events/defaults`, org)).data).toMatchObject({
      startTime: "18:30",
      endTime: "20:30",
      location: "Alice Gym",
      address: "",
      deadlineDays: 2,
      deadlineHours: 0,
    });
    // The Owner's stay where they were, in the original keys.
    expect((await ctx.admin.call(`${ctx.base}/events/defaults`)).data).toMatchObject({
      startTime: "19:30",
      location: "Owner Hall",
      deadlineDays: 1,
    });
    expect(
      (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(`last_location:${alice.id}`).first())
        ?.value,
    ).toBe("Alice Gym");
    // Both venues stay in the shared 最近的场馆.
    const venues = (await get(`${GOOGLE}/events/defaults`, org)).data.locations.map((l: { name: string }) => l.name);
    expect(venues).toEqual(expect.arrayContaining(["Alice Gym", "Owner Hall"]));

    // Forgetting a venue (the Owner's ✕) forgets it as everyone's default, without handing her the Owner's.
    await ctx.admin.call(`${ctx.base}/locations/remove`, { name: "Alice Gym" });
    expect((await get(`${GOOGLE}/events/defaults`, org)).data.location).toBe("");
  });

  it("keeps the shuttle price each person used last", async () => {
    const { ctx, org, bob, theirs, mine } = await scenario();
    for (const [id, cookie, price] of [
      [theirs, ctx.admin.cookie, "3"],
      [mine, org, "4"],
    ] as const) {
      await new Client().call(`${bob.base}/events/${id}/signup`, { friends: [] });
      await expire(id);
      const base = cookie === org ? GOOGLE : ctx.base;
      const res = await request(`${base}/events/${id}/finalize`, cookie, {
        courtTotal: "20",
        shuttleCount: 1,
        shuttlePrice: price,
      });
      expect(res.status).toBe(200);
    }
    const next = await newEvent(org, "Alice Gym", 9);
    const owners = await createTestEvent(ctx, { date: futureDate(10) });
    expect((await get(`${GOOGLE}/events/${next.data.id}/settlement`, org)).data.defaultShuttlePrice).toBe("4.00");
    expect((await ctx.admin.call(`${ctx.base}/events/${owners.id}/settlement`)).data.defaultShuttlePrice).toBe("3.00");
  });
});

describe("the member pages", () => {
  it("lets an organizer use the same member identity to sign up for another manager's event", async () => {
    const { org, alice, theirs } = await scenario();
    expect((await request(`/api/m/session/events/${theirs}/signup`, org, { friends: [] })).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT member_id FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index = 0",
      )
        .bind(theirs, alice.id)
        .first(),
    ).toEqual({ member_id: alice.id });
    expect((await get(`${GOOGLE}/members`, org)).data.viewer).toEqual({
      id: alice.id,
      role: "organizer",
      caps: [...ROLE_CAPABILITIES.organizer],
    });
  });

  it("names the organizer on the events they run, and nobody on the Owner's", async () => {
    const { bob, org, theirs, mine } = await scenario();
    const { data } = await get(`${bob.base}/events`, "");
    const of = (id: number) => data.events.find((e: { id: number }) => e.id === id);
    expect(of(mine).organizer).toBe("Alice");
    expect(of(theirs).organizer).toBeNull();
    // Alice's own page doesn't name her on the event she runs.
    const hers = (await get("/api/m/session/events", org)).data;
    expect(hers.events.find((e: { id: number }) => e.id === mine).organizer).toBeNull();
    // With the feature off nobody is named, as before.
    const off = (await get(`${bob.base}/events`, "", "0")).data;
    expect(off.events.find((e: { id: number }) => e.id === mine).organizer).toBeNull();
  });

  it("offers 管理页 to the Owner and organizers signed in with Google, and only while they are one", async () => {
    const { org, alice, bob } = await scenario();
    expect((await get("/api/m/session/me", org)).data.canAdmin).toBe(true);
    // Through the personal link the admin page is not offered (it needs the Google session).
    expect((await new Client().call(`${alice.base}/me`)).data.canAdmin).toBe(false);
    // With the feature off an organizer is a member like any other.
    expect((await get("/api/m/session/me", org, "0")).data.canAdmin).toBe(false);
    const bobGoogle = await googleCookie("google-bob", "bob@gmail.com");
    await env.DB.prepare("UPDATE members SET google_sub = 'google-bob' WHERE id = ?").bind(bob.id).run();
    expect((await get("/api/m/session/me", bobGoogle)).data.canAdmin).toBe(false);
    // The Owner signed in with Google keeps it, flag or no flag.
    await env.DB.prepare("UPDATE members SET google_sub = 'google-jay' WHERE is_owner = 1").run();
    const jay = await googleCookie("google-jay", "jay@gmail.com");
    expect((await get("/api/m/session/me", jay, "0")).data.canAdmin).toBe(true);
  });

  it("reports the role and the flag in the session, without isAdmin", async () => {
    const { org } = await scenario();
    const on = (await get("/api/auth/session", org)).data;
    expect(on).toMatchObject({ role: "organizer", organizers: true });
    expect(on).not.toHaveProperty("isAdmin");
    expect((await get("/api/auth/session", org, "0")).data).toMatchObject({ role: "member", organizers: false });
  });
});
