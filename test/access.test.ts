import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ADMIN_ACCESS } from "../src/worker/access";
import { can } from "../src/worker/organizers";
import { adminRoutes } from "../src/worker/routes/admin";
import {
  approveMember,
  appoint,
  Client,
  createTestEvent,
  expire,
  futureDate,
  GOOGLE,
  googleCookie,
  request,
  setUpAdmin,
} from "./helpers";

type Ids = { id: number; rid: number; pid: number; receipt: number; iid: number };

const fees = { courtTotal: "40", shuttleCount: 2, shuttlePrice: "3" };

/**
 * The Owner runs one finalized event, the organizer Alice another; Bob plays in both. Each event
 * has a bill with a payment record, and each account a 待确认 payment.
 */
async function scenario() {
  const ctx = await setUpAdmin();
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const org = await appoint(alice.id, "alice");
  // Her events are paid into her own Venmo, which Finalize needs.
  expect(
    (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" }))
      .status,
  ).toBe(200);
  const ownerId = (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;

  const theirs = await createTestEvent(ctx);
  const created = await request(`${GOOGLE}/events`, org, {
    date: futureDate(8),
    startTime: "19:00",
    endTime: "21:00",
    location: "Alice Gym",
    deadlineDays: 1,
    deadlineHours: 0,
  });
  expect(created.status).toBe(200);
  const mine = (await created.json()) as { id: number };

  const sides = { theirs: { id: theirs.id as number, cookie: "" }, mine: { id: mine.id, cookie: org } };
  const out = {} as Record<"theirs" | "mine", Ids>;
  for (const side of ["theirs", "mine"] as const) {
    const id = sides[side].id;
    await new Client().call(`${bob.base}/events/${id}/signup`, { friends: ["Tom"] });
    await expire(id);
    const finalize =
      side === "theirs"
        ? await ctx.admin.call(`${ctx.base}/events/${id}/finalize`, fees)
        : { status: (await request(`${GOOGLE}/events/${id}/finalize`, org, fees)).status };
    expect(finalize.status).toBe(200);
    const tom = await env.DB.prepare("SELECT id FROM registrations WHERE event_id = ? AND friend_index > 0")
      .bind(id)
      .first<{ id: number }>();
    const pay = await env.DB.prepare("SELECT id FROM payments WHERE event_id = ? AND member_id = ?")
      .bind(id, bob.id)
      .first<{ id: number }>();
    const rec = await env.DB.prepare(
      `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at) VALUES (?, 100, 'manual', ?) RETURNING id`,
    )
      .bind(pay!.id, new Date().toISOString())
      .first<{ id: number }>();
    const inbound = await env.DB.prepare(
      `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind, payee_id)
       VALUES (?, 'Bob', 500, 'x', ?, 'unmatched', ?) RETURNING id`,
    )
      .bind(`txn-${side}`, new Date().toISOString(), side === "mine" ? alice.id : ownerId)
      .first<{ id: number }>();
    out[side] = { id, rid: tom!.id, pid: pay!.id, receipt: rec!.id, iid: inbound!.id };
  }
  return { ctx, alice, bob, org, ownerId, ids: out };
}

/** Fills a route pattern like /events/:id/roster/:rid/remove with one side's ids. */
function fill(pattern: string, ids: Record<string, number>) {
  return pattern.replace(/:(\w+)/g, (_, name: string) => {
    if (name === "rid") return String(pattern.startsWith("/receipts") ? ids.receipt : ids.rid);
    return String(ids[name]);
  });
}

const scoped = Object.entries(ADMIN_ACCESS).filter(([, rule]) => rule.cap === "event" || rule.cap === "payee");

describe("the admin access table", () => {
  it("lists every admin endpoint, and nothing that isn't one", () => {
    const routes = new Set(
      adminRoutes.routes
        .filter((r) => r.method !== "ALL" && r.path.startsWith("/:token/"))
        .map((r) => `${r.method} ${r.path.slice("/:token".length)}`),
    );
    expect(routes.size).toBeGreaterThan(50);
    const missing = [...routes].filter((k) => !(k in ADMIN_ACCESS));
    expect(missing, "endpoints without an entry in ADMIN_ACCESS").toEqual([]);
    expect(Object.keys(ADMIN_ACCESS).filter((k) => !routes.has(k))).toEqual([]);
  });
});

describe("organizers on the admin pages", () => {
  it("refuses every event and payee endpoint for someone else's event or payment", async () => {
    const { org, ids } = await scenario();
    for (const [key] of scoped) {
      const [method, pattern] = key.split(" ") as [string, string];
      const res = await request(
        `${GOOGLE}${fill(pattern, ids.theirs)}`,
        org,
        method === "POST" ? { paymentId: ids.mine.pid, friends: [], ...fees } : undefined,
      );
      expect(res.status, key).toBe(403);
    }
    // Nothing changed on the Owner's event.
    expect((await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(ids.theirs.id).first())?.status).toBe(
      "finalized",
    );
    expect(
      (await env.DB.prepare("SELECT state FROM inbound_payments WHERE id = ?").bind(ids.theirs.iid).first())?.state,
    ).toBe("open");
  });

  // This walks every admin endpoint against D1; allow time for the full matrix on slower runners.
  it("lets them use exactly the endpoints their capabilities allow, on their own event and payments", async () => {
    const { org, ids } = await scenario();
    // 不再当组织者 ends their admin access, so it goes last.
    const last = "POST /organizer/retire";
    const entries = Object.entries(ADMIN_ACCESS).sort(([a], [b]) => Number(a === last) - Number(b === last));
    for (const [key, rule] of entries) {
      const [method, pattern] = key.split(" ") as [string, string];
      const res = await request(
        `${GOOGLE}${fill(pattern, ids.mine)}`,
        org,
        method === "POST" ? { paymentId: ids.mine.pid, friends: [], ...fees } : undefined,
      );
      if (rule.cap === null || can("organizer", rule.cap))
        // Some refuse for the event's state (already paid, already finalized); none for who is asking.
        expect([401, 403], `${key} → ${res.status}`).not.toContain(res.status);
      else expect(res.status, key).toBe(403);
    }
  }, 20_000);

  it("gives /events/defaults its own rule rather than /events/:id's, and remembers each person's own", async () => {
    const { ctx, org } = await scenario();
    const defaults = await request(`${GOOGLE}/events/defaults`, org);
    expect(defaults.status).toBe(200);
    // Alice's event (created at Alice Gym in the scenario) is her next form's default, not the Owner's.
    expect(((await defaults.json()) as any).location).toBe("Alice Gym");
    expect((await ctx.admin.call(`${ctx.base}/events/defaults`)).data.location).toBe("Bay Badminton Center");
  });

  it("checks the roster row belongs to the event in the path", async () => {
    const { ctx, org, ids } = await scenario();
    const mixed = `/events/${ids.mine.id}/roster/${ids.theirs.rid}`;
    expect((await request(`${GOOGLE}${mixed}/rename`, org, { name: "X" })).status).toBe(403);
    expect((await request(`${GOOGLE}${mixed}/remove`, org, {})).status).toBe(403);
    // The Owner may manage both events, but still not with a row from the other one.
    expect((await ctx.admin.call(`${ctx.base}${mixed}/remove`, {})).status).toBe(403);
    expect(
      await env.DB.prepare("SELECT 1 FROM registrations WHERE id = ?").bind(ids.theirs.rid).first(),
    ).not.toBeNull();
    // A second 移除 of a row that is gone already changes nothing, as before.
    const own = `${ctx.base}/events/${ids.theirs.id}/roster/${ids.theirs.rid}/remove`;
    expect((await ctx.admin.call(own, {})).status).toBe(200);
    expect((await ctx.admin.call(own, {})).status).toBe(200);
    expect(
      (await request(`${GOOGLE}/events/${ids.mine.id}/roster/${ids.mine.rid}/rename`, org, { name: "T" })).status,
    ).toBe(200);
  });

  it("won't take back a Venmo payment that went into someone else's account", async () => {
    const { ctx, org, ids } = await scenario();
    // The Owner links a payment from their own account onto a bill of Alice's event.
    expect(
      (await ctx.admin.call(`${ctx.base}/inbound/${ids.theirs.iid}/link`, { paymentId: ids.mine.pid })).status,
    ).toBe(200);
    const r = await env.DB.prepare("SELECT id FROM payment_receipts WHERE inbound_id = ?")
      .bind(ids.theirs.iid)
      .first<{ id: number }>();
    expect((await request(`${GOOGLE}/receipts/${r!.id}/remove`, org, {})).status).toBe(403);
    expect((await ctx.admin.call(`${ctx.base}/receipts/${r!.id}/remove`, {})).status).toBe(200);
  });

  it("refuses ids that aren't numbers instead of failing", async () => {
    const { org } = await scenario();
    expect((await request(`${GOOGLE}/events/abc/edit`, org, {})).status).toBe(403);
    expect((await request(`${GOOGLE}/inbound/x/ignore`, org, {})).status).toBe(403);
    expect((await request(`${GOOGLE}/payments/1.5/mark-paid`, org, {})).status).toBe(403);
  });

  it("links only their own payment, and only to a bill of their own event", async () => {
    const { org, ids } = await scenario();
    const link = (iid: number, pid: number) => request(`${GOOGLE}/inbound/${iid}/link`, org, { paymentId: pid });
    expect((await link(ids.mine.iid, ids.theirs.pid)).status).toBe(403);
    expect((await link(ids.theirs.iid, ids.mine.pid)).status).toBe(403);
    expect((await link(ids.mine.iid, ids.mine.pid)).status).toBe(200);
  });

  it("keeps group and system endpoints for the Owner", async () => {
    const { ctx, org, alice, bob } = await scenario();
    for (const [method, path] of [
      ["GET", `/members/${bob.id}/link`],
      ["POST", `/members/${bob.id}/regenerate`],
      ["POST", `/members/${bob.id}/note`],
      ["GET", "/settings"],
      ["POST", "/settings"],
      ["POST", "/locations/remove"],
      ["GET", "/export/members.csv"],
      ["GET", "/sheets"],
      ["POST", "/settings/payment"],
      ["POST", "/settings/google/unbind"],
      ["POST", "/login"],
    ] as const) {
      expect((await request(`${GOOGLE}${path}`, org, method === "POST" ? {} : undefined)).status, path).toBe(403);
    }
    // Read-only member pages are theirs too, with only their own events' amounts owed.
    const members = await request(`${GOOGLE}/members`, org);
    expect(members.status).toBe(200);
    const bobRow = ((await members.json()) as any).active.find((m: { id: string }) => m.id === bob.id);
    const owed = await env.DB.prepare(
      "SELECT SUM(amount_due_cents - amount_paid_cents) AS n FROM payments p JOIN events e ON e.id = p.event_id WHERE p.member_id = ? AND e.manager_id = ?",
    )
      .bind(bob.id, alice.id)
      .first<{ n: number }>();
    expect(bobRow.owingCents).toBe(owed!.n);
    expect(bobRow.owingCents).toBeGreaterThan(0);
    expect(
      (await ctx.admin.call(`${ctx.base}/members`)).data.active.find((m: { id: string }) => m.id === bob.id).owingCents,
    ).toBeGreaterThan(owed!.n);
    expect((await request(`${GOOGLE}/members/${bob.id}/profile`, org)).status).toBe(200);
  });

  it("lists only their own events and payments", async () => {
    const { ctx, org, ids } = await scenario();
    const events = (await (await request(`${GOOGLE}/events`, org)).json()) as any;
    expect([...events.current, ...events.past].map((e: { id: number }) => e.id)).toEqual([ids.mine.id]);
    const all = (await ctx.admin.call(`${ctx.base}/events`)).data;
    expect(all.current.map((e: { id: number }) => e.id).sort()).toEqual([ids.theirs.id, ids.mine.id].sort());

    const inbound = (await (await request(`${GOOGLE}/inbound`, org)).json()) as any;
    expect(inbound.open.map((i: { id: number }) => i.id)).toEqual([ids.mine.iid]);
    expect(inbound.payments.map((p: { id: number }) => p.id)).toEqual([ids.mine.pid]);
    const owner = (await ctx.admin.call(`${ctx.base}/inbound`)).data;
    expect(owner.open.map((i: { id: number }) => i.id).sort()).toEqual([ids.theirs.iid, ids.mine.iid].sort());
  });

  it("makes whoever creates an event its manager and payee, and signs them up", async () => {
    const { ctx, alice, org, ownerId } = await scenario();
    const res = await request(`${GOOGLE}/events`, org, {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
      joinSelf: true,
    });
    const e = (await res.json()) as { id: number };
    expect(await env.DB.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(e.id).first()).toEqual({
      manager_id: alice.id,
      payee_id: alice.id,
    });
    expect(
      await env.DB.prepare("SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ?")
        .bind(e.id, alice.id)
        .first(),
    ).not.toBeNull();
    // 我的报名 signs up the organizer, not the Owner.
    expect((await request(`${GOOGLE}/events/${e.id}/self-cancel`, org, {})).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ?")
        .bind(e.id, alice.id)
        .first(),
    ).toBeNull();
    // The Owner's own events stay theirs.
    const own = await createTestEvent(ctx);
    expect(await env.DB.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(own.id).first()).toEqual({
      manager_id: ownerId,
      payee_id: ownerId,
    });
  });

  it("shuts them out while the flag is off, and as soon as they are revoked", async () => {
    const { alice, org } = await scenario();
    expect((await request(`${GOOGLE}/events`, org)).status).toBe(200);
    const off = await request(`${GOOGLE}/events`, org, undefined, "0");
    expect(off.status).toBe(401);
    expect(((await off.json()) as any).error.code).toBe("google_admin_required");
    expect((await request(`${GOOGLE}/members`, org, undefined, "0")).status).toBe(401);
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(alice.id).run();
    expect((await request(`${GOOGLE}/events`, org)).status).toBe(401);
  });

  it("never lets an organizer use the admin link", async () => {
    const { ctx, org } = await scenario();
    // The link path only knows the Owner's password session; a Google cookie adds nothing.
    expect((await request(`${ctx.base}/events`, org)).status).toBe(401);
  });

  it("reports the role in the Google session", async () => {
    const { org } = await scenario();
    expect(await (await request("/api/auth/session", org)).json()).toMatchObject({
      role: "organizer",
      organizers: true,
    });
    expect(await (await request("/api/auth/session", org, undefined, "0")).json()).toMatchObject({ role: "member" });
    const bob = await googleCookie("google-nobody", "nobody@gmail.com");
    expect(await (await request("/api/auth/session", bob)).json()).toMatchObject({ role: "member" });
  });
});
