import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { finalize } from "../src/worker/billing";
import { getEvent } from "../src/worker/events";
import { issueMemberToken } from "../src/worker/members";
import {
  approveMember,
  Client,
  createTestEvent,
  expire,
  futureDate,
  GOOGLE,
  googleCookie,
  request,
  setUpAdmin,
} from "./helpers";

const db = env.DB;
const fees = { courtTotal: "40", shuttleCount: 2, shuttlePrice: "3" };

/** Links a member's Google account (what 设为组织者 requires); returns that account's session. */
async function withGoogle(memberId: string, name: string) {
  await db
    .prepare("UPDATE members SET google_sub = ?, google_email = ? WHERE id = ?")
    .bind(`google-${name}`, `${name}@gmail.com`, memberId)
    .run();
  return googleCookie(`google-${name}`, `${name}@gmail.com`);
}

/** The Owner on the admin link, with the feature on (or off). */
async function owner(organizers = "1") {
  const ctx = await setUpAdmin();
  const call = async (path: string, body?: unknown) => {
    const res = await request(`${ctx.base}${path}`, ctx.admin.cookie, body, organizers);
    return { status: res.status, data: (await res.json()) as any };
  };
  return { ctx, call };
}

/** An organizer's event: created through Google, so they run it and are paid for it. */
async function organizerEvent(cookie: string, days = 8) {
  const res = await request(`${GOOGLE}/events`, cookie, {
    date: futureDate(days),
    startTime: "19:00",
    endTime: "21:00",
    location: "Alice Gym",
    deadlineDays: 1,
    deadlineHours: 0,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: number }).id;
}

const eventRow = (id: number) =>
  db.prepare("SELECT manager_id, payee_id, status FROM events WHERE id = ?").bind(id).first();

/** Alice is an organizer with her payment settings filled in. */
async function withOrganizer() {
  const o = await owner();
  const alice = await approveMember(o.ctx, "Alice");
  const cookie = await withGoogle(alice.id, "alice");
  expect((await o.call(`/members/${alice.id}/appoint`, {})).status).toBe(200);
  expect(
    (await request(`${GOOGLE}/payment-profile`, cookie, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" }))
      .status,
  ).toBe(200);
  return { ...o, alice, cookie };
}

/** An event Alice runs, finalized: Bob is billed and pays into her account. */
async function finalizedEvent(cookie: string, bobBase: string) {
  const id = await organizerEvent(cookie, 9);
  await new Client().call(`${bobBase}/events/${id}/signup`, { friends: [] });
  await expire(id);
  expect((await request(`${GOOGLE}/events/${id}/finalize`, cookie, fees)).status).toBe(200);
  return id;
}

describe("appointing organizers", () => {
  it("is refused, and shows nothing, while the feature is off", async () => {
    const { ctx, call } = await owner("0");
    const alice = await approveMember(ctx, "Alice");
    await withGoogle(alice.id, "alice");
    const members = await call("/members");
    expect(members.data.organizers).toBeNull();
    expect(members.data.active.every((m: any) => m.isOrganizer === false)).toBe(true);
    expect((await call(`/members/${alice.id}/appoint`, {})).status).toBe(403);
    expect((await call(`/members/${alice.id}/revoke`, {})).status).toBe(403);
    const e = await createTestEvent(ctx);
    expect((await call(`/events/${e.id}/transfer`, { to: alice.id })).status).toBe(403);
    expect(await db.prepare("SELECT role FROM members WHERE id = ?").bind(alice.id).first()).toEqual({
      role: "member",
    });
  });

  it("needs an active member who signs in with Google", async () => {
    const { ctx, call } = await owner();
    const alice = await approveMember(ctx, "Alice");
    const noGoogle = await call(`/members/${alice.id}/appoint`, {});
    expect(noGoogle.status).toBe(400);
    expect(noGoogle.data.error.message).toContain("Google");
    expect((await call("/members/M001/appoint", {})).status).toBe(400);

    await withGoogle(alice.id, "alice");
    const done = await call(`/members/${alice.id}/appoint`, {});
    expect(done.status).toBe(200);
    // No email service in tests: the page tells the Owner to let them know.
    expect(done.data.emailStatus).toBe("not_configured");
    expect((await call(`/members/${alice.id}/appoint`, {})).status).toBe(400);

    const bob = await approveMember(ctx, "Bob");
    await withGoogle(bob.id, "bob");
    await call(`/members/${bob.id}/deactivate`, {});
    expect((await call(`/members/${bob.id}/appoint`, {})).status).toBe(400);
  });

  it("shows the badge and the organizer block to the Owner and, read-only, to organizers", async () => {
    const { ctx, call, alice, cookie } = await withOrganizer();
    await organizerEvent(cookie);
    const members = await call("/members");
    expect(members.data.active.find((m: any) => m.id === alice.id).isOrganizer).toBe(true);
    expect(members.data.active.find((m: any) => m.isOwner).isOrganizer).toBe(false);
    expect(members.data.organizers).toMatchObject({
      canManage: true,
      list: [
        { id: alice.id, username: "Alice", paymentReady: true, lastVenmoEmailAt: null, telegram: false, events: 1 },
      ],
      former: [],
    });
    expect(members.data.organizers.list[0].since).toBeTruthy();

    const seen = await request(`${GOOGLE}/members`, cookie);
    expect(seen.status).toBe(200);
    const block = ((await seen.json()) as any).organizers;
    expect(block.canManage).toBe(false);
    expect(block.list).toEqual(members.data.organizers.list);

    // An organizer can't appoint, revoke or transfer.
    const bob = await approveMember(ctx, "Bob");
    await withGoogle(bob.id, "bob");
    expect((await request(`${GOOGLE}/members/${bob.id}/appoint`, cookie, {})).status).toBe(403);
    expect((await request(`${GOOGLE}/members/${alice.id}/revoke`, cookie)).status).toBe(403);
    expect((await request(`${GOOGLE}/members/${alice.id}/revoke`, cookie, {})).status).toBe(403);
    const mine = await organizerEvent(cookie, 10);
    expect((await request(`${GOOGLE}/events/${mine}/transfer`, cookie, { to: "M001" })).status).toBe(403);
  });
});

describe("revoking an organizer", () => {
  it("hands back unfinalized events, keeps the payee of finalized ones, and leaves archived ones", async () => {
    const { ctx, call, alice, cookie } = await withOrganizer();
    const bob = await approveMember(ctx, "Bob");
    const open = await organizerEvent(cookie);
    const finalized = await finalizedEvent(cookie, bob.base);
    const archived = await organizerEvent(cookie, 11);
    await db.prepare("UPDATE events SET status = 'settled' WHERE id = ?").bind(archived).run();

    const preview = await call(`/members/${alice.id}/revoke`);
    expect(preview.data.events.map((e: any) => [e.id, e.outcome])).toEqual([
      [open, "to_owner"],
      [finalized, "payee_stays"],
    ]);

    const done = await call(`/members/${alice.id}/revoke`, {});
    expect(done.status).toBe(200);
    expect(done.data.emailStatus).toBe("not_configured");
    expect(await eventRow(open)).toMatchObject({ manager_id: "M001", payee_id: "M001" });
    expect(await eventRow(finalized)).toMatchObject({ manager_id: "M001", payee_id: alice.id });
    expect(await eventRow(archived)).toMatchObject({ manager_id: alice.id, payee_id: alice.id });

    const profile = await db
      .prepare("SELECT venmo_username, retired_at FROM payment_profiles WHERE member_id = ?")
      .bind(alice.id)
      .first<{ venmo_username: string; retired_at: string | null }>();
    expect(profile!.venmo_username).toBe("alice-v");
    expect(profile!.retired_at).toBeTruthy();

    // Her Google session is shut out on the next request.
    expect((await request(`${GOOGLE}/members`, cookie)).status).toBe(401);
    expect((await request(`${GOOGLE}/events/${finalized}`, cookie)).status).toBe(401);

    // Still paid into her account: listed as a 历史收款人.
    const block = (await call("/members")).data.organizers;
    expect(block.list).toEqual([]);
    expect(block.former).toEqual([{ id: alice.id, username: "Alice", collecting: 1 }]);
    expect((await call(`/members/${alice.id}/revoke`, {})).status).toBe(400);
    expect((await call(`/members/${alice.id}/revoke`)).status).toBe(400);

    // Appointed again: the same payment settings, no longer retired.
    expect((await call(`/members/${alice.id}/appoint`, {})).status).toBe(200);
    expect(
      await db
        .prepare("SELECT venmo_username, retired_at FROM payment_profiles WHERE member_id = ?")
        .bind(alice.id)
        .first(),
    ).toEqual({ venmo_username: "alice-v", retired_at: null });
    expect((await request(`${GOOGLE}/members`, cookie)).status).toBe(200);
  });

  it("leaves an event someone else runs now with them, and says the money still goes to them", async () => {
    const { ctx, call, alice, cookie } = await withOrganizer();
    const bob = await approveMember(ctx, "Bob");
    await withGoogle(bob.id, "bob");
    expect((await call(`/members/${bob.id}/appoint`, {})).status).toBe(200);
    const finalized = await finalizedEvent(cookie, bob.base);
    expect((await call(`/events/${finalized}/transfer`, { to: bob.id })).status).toBe(200);
    const preview = await call(`/members/${alice.id}/revoke`);
    expect(preview.data.events.map((e: any) => e.outcome)).toEqual(["payee_only"]);
    expect((await call(`/members/${alice.id}/revoke`, {})).status).toBe(200);
    expect(await eventRow(finalized)).toMatchObject({ manager_id: bob.id, payee_id: alice.id });
  });

  it("retires someone with no events at once", async () => {
    const { call, alice } = await withOrganizer();
    expect((await call(`/members/${alice.id}/revoke`)).data.events).toEqual([]);
    expect((await call(`/members/${alice.id}/revoke`, {})).status).toBe(200);
    expect((await call("/members")).data.organizers).toMatchObject({ list: [], former: [] });
  });

  it("lets organizers step down themselves by the same rules", async () => {
    const { call, alice, cookie } = await withOrganizer();
    expect((await call("/organizer/retire", {})).status).toBe(400); // the Owner can't
    const open = await organizerEvent(cookie);
    const preview = await request(`${GOOGLE}/organizer/retire`, cookie);
    expect(((await preview.json()) as any).events.map((e: any) => e.outcome)).toEqual(["to_owner"]);
    expect((await request(`${GOOGLE}/organizer/retire`, cookie, {})).status).toBe(200);
    expect(await eventRow(open)).toMatchObject({ manager_id: "M001", payee_id: "M001" });
    expect(await db.prepare("SELECT role FROM members WHERE id = ?").bind(alice.id).first()).toEqual({
      role: "member",
    });
    expect((await request(`${GOOGLE}/organizer/retire`, cookie, {})).status).toBe(401);
  });

  it("revokes before disabling, and refuses to delete someone members still pay", async () => {
    const { ctx, call, alice, cookie } = await withOrganizer();
    const bob = await approveMember(ctx, "Bob");
    const open = await organizerEvent(cookie);
    const finalized = await finalizedEvent(cookie, bob.base);
    const off = await call(`/members/${alice.id}/deactivate`, {});
    expect(off.status).toBe(200);
    expect(off.data.revoked.emailStatus).toBe("not_configured");
    expect(await db.prepare("SELECT role, status FROM members WHERE id = ?").bind(alice.id).first()).toEqual({
      role: "member",
      status: "inactive",
    });
    expect(await eventRow(open)).toMatchObject({ manager_id: "M001", payee_id: "M001" });
    expect(await eventRow(finalized)).toMatchObject({ manager_id: "M001", payee_id: alice.id });

    const refused = await call(`/members/${alice.id}/delete`, {});
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toContain("收款人");
    await db.prepare("UPDATE events SET status = 'settled' WHERE id = ?").bind(finalized).run();
    expect((await call(`/members/${alice.id}/delete`, {})).status).toBe(200);
  });
});

describe("transferring an event", () => {
  it("moves the payee with the manager before Finalize, and only the manager after", async () => {
    const { ctx, call, alice, cookie } = await withOrganizer();
    const bob = await approveMember(ctx, "Bob");
    const mine = await createTestEvent(ctx);

    const moved = await call(`/events/${mine.id}/transfer`, { to: alice.id });
    expect(moved.status).toBe(200);
    expect(moved.data.manager).toMatchObject({ id: alice.id, name: "Alice" });
    expect(moved.data.payee).toMatchObject({ id: alice.id, name: "Alice" });
    expect(await eventRow(mine.id)).toMatchObject({ manager_id: alice.id, payee_id: alice.id });
    // Now hers to run.
    expect((await request(`${GOOGLE}/events/${mine.id}`, cookie)).status).toBe(200);

    const back = await call(`/events/${mine.id}/transfer`, { to: "M001" });
    expect(back.data.manager).toMatchObject({ id: "M001", name: "群主" });
    expect(await eventRow(mine.id)).toMatchObject({ manager_id: "M001", payee_id: "M001" });

    const finalized = await finalizedEvent(cookie, bob.base);
    expect((await call(`/events/${finalized}/transfer`, { to: "M001" })).status).toBe(200);
    expect(await eventRow(finalized)).toMatchObject({ manager_id: "M001", payee_id: alice.id });

    await db.prepare("UPDATE events SET status = 'settled' WHERE id = ?").bind(finalized).run();
    expect((await call(`/events/${finalized}/transfer`, { to: alice.id })).status).toBe(400);
    expect((await call(`/events/${mine.id}/transfer`, { to: bob.id })).status).toBe(400);
    expect((await call(`/events/${mine.id}/transfer`, { to: "M999" })).status).toBe(404);
  });
});

describe("an organizer's member link", () => {
  it("can't swap in another Google account to impersonate them", async () => {
    const { alice } = await withOrganizer();
    const token = await issueMemberToken(env, alice.id);
    const mallory = await googleCookie("google-mallory", "mallory@gmail.com");
    const res = await request("/api/auth/link", mallory, { token });
    expect(res.status).toBe(409);
    expect(await db.prepare("SELECT google_sub FROM members WHERE id = ?").bind(alice.id).first()).toEqual({
      google_sub: "google-alice",
    });
    // And members have no way to unlink Google themselves.
    expect((await request(`/api/m/${token}/google/unlink`, "", {})).status).toBe(404);
    expect((await request("/api/auth/unlink", mallory, {})).status).toBe(404);
  });
});

describe("a 转交 racing a Finalize", () => {
  it("refuses the Finalize instead of billing for the payee it read before the change", async () => {
    const { ctx, call, cookie } = await withOrganizer();
    const bob = await approveMember(ctx, "Bob");
    const id = await organizerEvent(cookie);
    await new Client().call(`${bob.base}/events/${id}/signup`, { friends: [] });
    await expire(id);
    const stale = await getEvent(env as any, id); // what Finalize read: Alice is the payee
    expect((await call(`/events/${id}/transfer`, { to: "M001" })).status).toBe(200);
    await expect(
      finalize(env as any, stale, { courtTotalCents: 4000, shuttleCount: 2, shuttlePriceCents: 300 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM payments WHERE event_id = ?").bind(id).first()).toEqual({
      n: 0,
    });
    expect(await eventRow(id)).toMatchObject({ status: "closed", payee_id: "M001" });
  });
});
