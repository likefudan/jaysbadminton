import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { assertPayeeUnlocked } from "../src/worker/payees";
import {
  appoint,
  approveMember,
  Client,
  expire,
  futureDate,
  GOOGLE,
  googleCookie,
  request,
  setUpAdmin,
} from "./helpers";

const fees = { courtTotal: "100", shuttleCount: 4, shuttlePrice: "3" };
const json = async (res: Response) => (await res.json()) as any;
const ownerPayment = { password: "initial-password", venmoUsername: "KeLi8916", venmoEmail: "owner@example.com" };

/**
 * The organizer Alice runs an event with her own Venmo; she brings Ann, the Owner Jay and Bob play.
 * 4 registered, all attend: court 25.00, shuttles 3.00 each.
 */
async function scenario({ finalize = true } = {}) {
  const ctx = await setUpAdmin();
  await ctx.admin.call(`${ctx.base}/settings/payment`, ownerPayment);
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const org = await appoint(alice.id, "alice");
  const owner = (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;
  const profile = (body: Record<string, unknown>, cookie = org) => request(`${GOOGLE}/payment-profile`, cookie, body);
  expect(
    (await profile({ venmoUsername: "@Alice-V", venmoEmail: "Alice@Venmo.test", zelleAccount: "a@z" })).status,
  ).toBe(200);

  const created = await request(`${GOOGLE}/events`, org, {
    date: futureDate(8),
    startTime: "19:00",
    endTime: "21:00",
    location: "Alice Gym",
    deadlineDays: 1,
    deadlineHours: 0,
    joinSelf: true,
  });
  const e = await json(created);
  const eb = `${GOOGLE}/events/${e.id}`;
  await request(`${eb}/roster/add`, org, { memberId: alice.id, friends: ["Ann"] });
  await request(`${eb}/roster/add`, org, { memberId: owner, includeSelf: true });
  await new Client().call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
  await expire(e.id);
  if (finalize) expect((await request(`${eb}/finalize`, org, fees)).status).toBe(200);
  const bills = async () =>
    Object.fromEntries(
      (await json(await request(`${eb}/settlement`, org))).payments.map((p: { memberName: string }) => [
        p.memberName,
        p,
      ]),
    );
  return { ...ctx, alice, bob, org, owner, e, eb, profile, bills };
}

describe("an organizer's event is paid to the organizer", () => {
  it("pays the organizer's own bill (friends included) by itself, and bills the Owner like anyone", async () => {
    const s = await scenario();
    const b = await s.bills();
    expect(b.Alice).toMatchObject({ isPayee: true, amountDueCents: 2 * 2800, status: "paid" });
    expect(b.Alice.receipts).toMatchObject([{ method: "manual", amountCents: 5600 }]);
    expect(b.Jay).toMatchObject({ isPayee: false, amountDueCents: 2800, status: "unpaid", receipts: [] });
    expect(b.Bob).toMatchObject({ isPayee: false, status: "unpaid" });
    expect((await json(await request(`${s.eb}/settlement`, s.org))).payeeIsMe).toBe(true);
    // The Owner looking at it sees whose bill pays itself, not "me".
    const asOwner = (await s.admin.call(`${s.base}/events/${s.e.id}/settlement`)).data;
    expect(asOwner.payeeIsMe).toBe(false);
    expect((await s.admin.call(`${s.base}/events/${s.e.id}`)).data.payee).toEqual({
      id: s.alice.id,
      name: "Alice",
      isMe: false,
    });
  });

  it("follows the payee when fees change or people leave after Finalize", async () => {
    const s = await scenario();
    await request(`${s.eb}/finalize`, s.org, { ...fees, courtTotal: "200" });
    let b = await s.bills();
    expect(b.Alice).toMatchObject({ amountDueCents: 2 * 5300, status: "paid", receipts: [{ amountCents: 10600 }] });
    expect(b.Jay).toMatchObject({ amountDueCents: 5300, status: "unpaid" });

    // Ann leaves (3 left: court 66.67, shuttles 4.00): Alice's own share still pays itself, at the new amount.
    const roster = (await json(await request(s.eb, s.org))).roster;
    const ann = roster.find((r: { name: string }) => r.name === "Ann");
    expect((await request(`${s.eb}/roster/${ann.id}/remove`, s.org, {})).status).toBe(200);
    b = await s.bills();
    expect(b.Alice).toMatchObject({ amountDueCents: 7067, status: "paid", receipts: [{ amountCents: 7067 }] });

    // Alice leaves altogether: her bill only ever had her own receipts, so it goes.
    const self = roster.find((r: { name: string }) => r.name === "Alice");
    expect((await request(`${s.eb}/roster/${self.id}/remove`, s.org, {})).status).toBe(200);
    b = await s.bills();
    expect(b.Alice).toBeUndefined();
    expect(b.Jay).toMatchObject({ amountDueCents: 10600, status: "unpaid" });
  });

  it("lets the Owner's bill be marked paid but not the payee's own receipt be undone, nor linked to", async () => {
    const s = await scenario();
    const b = await s.bills();
    expect((await request(`${GOOGLE}/payments/${b.Jay.id}/mark-paid`, s.org, {})).status).toBe(200);
    const undo = await request(`${GOOGLE}/receipts/${b.Alice.receipts[0].id}/remove`, s.org, {});
    expect(undo.status).toBe(400);
    expect((await json(undo)).error.message).toBe("Alice本人的账单自动记为已付，不用撤销");

    const inbound = await env.DB.prepare(
      `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind, payee_id)
       VALUES ('T1', 'X', 500, 'x', ?, 'unmatched', ?) RETURNING id`,
    )
      .bind(new Date().toISOString(), s.alice.id)
      .first<{ id: number }>();
    const offered = (await json(await request(`${GOOGLE}/inbound`, s.org))).payments.map(
      (p: { memberName: string }) => p.memberName,
    );
    expect(offered).toContain("Jay");
    expect(offered).not.toContain("Alice");
    const link = await request(`${GOOGLE}/inbound/${inbound!.id}/link`, s.org, { paymentId: b.Alice.id });
    expect((await json(link)).error.message).toBe("Alice本人的账单不用关联");
  });

  it("shows members the organizer's Venmo and name on the bill, and the Owner's on the Owner's events", async () => {
    const s = await scenario();
    const mine = (await new Client().call(`${s.bob.base}/events`)).data.events.find(
      (x: { id: number }) => x.id === s.e.id,
    );
    expect(mine.payment).toMatchObject({ payeeName: "Alice", venmoUsername: "Alice-V", zelleAccount: "a@z" });

    const theirs = (
      await s.admin.call(`${s.base}/events`, {
        date: futureDate(9),
        startTime: "19:00",
        endTime: "21:00",
        location: "Bay",
        deadlineDays: 1,
        deadlineHours: 0,
      })
    ).data;
    await new Client().call(`${s.bob.base}/events/${theirs.id}/signup`, { friends: [] });
    await expire(theirs.id);
    await s.admin.call(`${s.base}/events/${theirs.id}/finalize`, fees);
    const owed = (await new Client().call(`${s.bob.base}/events`)).data.events.find(
      (x: { id: number }) => x.id === theirs.id,
    );
    expect(owed.payment).toMatchObject({ payeeName: "群主", venmoUsername: "KeLi8916" });
  });

  it("keeps money with the payee in the database while the flag is off", async () => {
    const s = await scenario();
    // Unit tests run with the flag off: the organizer can't get in, but her event's bills are unchanged.
    expect((await request(`${GOOGLE}/events`, s.org, undefined, "0")).status).toBe(401);
    const mine = (await new Client().call(`${s.bob.base}/events`)).data.events.find(
      (x: { id: number }) => x.id === s.e.id,
    );
    expect(mine.payment).toMatchObject({ payeeName: "Alice", venmoUsername: "Alice-V" });
    const b = (await s.admin.call(`${s.base}/events/${s.e.id}/settlement`)).data.payments;
    expect(b.find((p: { memberName: string }) => p.memberName === "Alice")).toMatchObject({ isPayee: true });
  });
});

describe("an event with no payee recorded (written by older code after a rollback)", () => {
  it("is the Owner's: their bill pays itself, it isn't linkable, and members pay the Owner", async () => {
    const ctx = await setUpAdmin();
    await ctx.admin.call(`${ctx.base}/settings/payment`, ownerPayment);
    const bob = await approveMember(ctx, "Bob");
    const owner = (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;
    const e = (
      await ctx.admin.call(`${ctx.base}/events`, {
        date: futureDate(7),
        startTime: "19:00",
        endTime: "21:00",
        location: "Bay",
        deadlineDays: 1,
        deadlineHours: 0,
        joinSelf: true,
      })
    ).data;
    await env.DB.prepare("UPDATE events SET manager_id = NULL, payee_id = NULL WHERE id = ?").bind(e.id).run();
    await new Client().call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    await expire(e.id);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, fees)).status).toBe(200);
    const pays = (await ctx.admin.call(`${ctx.base}/events/${e.id}/settlement`)).data;
    expect(pays.payeeIsMe).toBe(true);
    const jay = pays.payments.find((p: { memberId: string }) => p.memberId === owner);
    expect(jay).toMatchObject({ isPayee: true, status: "paid" });
    const offered = (await ctx.admin.call(`${ctx.base}/inbound`)).data.payments.map(
      (p: { memberName: string }) => p.memberName,
    );
    expect(offered).toEqual(["Bob"]);
    const bill = (await new Client().call(`${bob.base}/events`)).data.events[0].payment;
    expect(bill).toMatchObject({ payeeName: "群主", venmoUsername: "KeLi8916" });
  });
});

describe("whoever runs the event signs up with the Owner's old privileges", () => {
  it("gives them on their own event only", async () => {
    const s = await scenario({ finalize: false });
    const mine = await googleCookie("google-alice", "alice@gmail.com");
    const asAlice = async () =>
      (await json(await request("/api/m/session/events", mine))).events.find((x: { id: number }) => x.id === s.e.id);
    // Closed but not finalized: she may still change hers, with no friend cap.
    expect(await asAlice()).toMatchObject({ status: "closed", canEdit: true, friendCap: 20 });
    expect(
      (await request(`/api/m/session/events/${s.e.id}/signup`, mine, { friends: ["Ann", "b", "c", "d", "e"] })).status,
    ).toBe(200);

    // The Owner on her event is a player like Bob: locked out after the deadline.
    const link = (await s.admin.call(`${s.base}/members/${s.owner}/regenerate`, {})).data.link as string;
    const jay = `/api/m/${link.split("/").pop()}`;
    const own = (await new Client().call(`${jay}/events`)).data.events.find((x: { id: number }) => x.id === s.e.id);
    expect(own).toMatchObject({ canEdit: false, friendCap: 3 });
    expect((await new Client().call(`${jay}/events/${s.e.id}/signup`, { friends: [] })).status).toBe(400);
  });

  it("not while the organizer feature is off", async () => {
    const s = await scenario({ finalize: false });
    const mine = await googleCookie("google-alice", "alice@gmail.com");
    const ev = (await json(await request("/api/m/session/events", mine, undefined, "0"))).events.find(
      (x: { id: number }) => x.id === s.e.id,
    );
    expect(ev).toMatchObject({ canEdit: false, friendCap: 3 });
  });
});

describe("Finalize needs the organizer's Venmo", () => {
  it("refuses until the payee filled in the Venmo username and notification email", async () => {
    const s = await scenario({ finalize: false });
    await env.DB.prepare("DELETE FROM payment_profiles").run();
    const res = await request(`${s.eb}/finalize`, s.org, fees);
    expect(res.status).toBe(400);
    expect((await json(res)).error.message).toBe("请先在收款设置里填好 Venmo 和通知邮箱");
    // The Owner finalizing it is told whose settings are missing.
    const owner = await s.admin.call(`${s.base}/events/${s.e.id}/finalize`, fees);
    expect(owner.data.error.message).toBe("本场收款人 Alice 还没在收款设置里填好 Venmo 和通知邮箱");

    expect((await s.profile({ venmoUsername: "alice-v", venmoEmail: "a@venmo.test" })).status).toBe(200);
    expect((await request(`${s.eb}/finalize`, s.org, fees)).status).toBe(200);
  });

  it("still lets the Owner finalize their own events without Venmo, as before", async () => {
    const ctx = await setUpAdmin();
    const bob = await approveMember(ctx, "Bob");
    const e = (
      await ctx.admin.call(`${ctx.base}/events`, {
        date: futureDate(7),
        startTime: "19:00",
        endTime: "21:00",
        location: "Bay",
        deadlineDays: 1,
        deadlineHours: 0,
      })
    ).data;
    await new Client().call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    await expire(e.id);
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, fees)).status).toBe(200);
  });
});

describe("我的收款设置", () => {
  it("returns and saves the organizer's own settings, and tells the Owner", async () => {
    const s = await scenario({ finalize: false });
    expect(await json(await request(`${GOOGLE}/payment-profile`, s.org))).toEqual({
      venmoUsername: "Alice-V",
      venmoEmail: "alice@venmo.test",
      zelleAccount: "a@z",
      outstandingBills: 0,
    });
    // The Owner's own stay behind the password.
    const owner = await s.admin.call(`${s.base}/payment-profile`, { venmoUsername: "x1", venmoEmail: "x@y.z" });
    expect(owner.status).toBe(400);
    expect((await s.admin.call(`${s.base}/payment-profile`)).data).toMatchObject({ venmoUsername: "KeLi8916" });
  });

  it("shows a notification email saved on its own", async () => {
    const s = await scenario({ finalize: false });
    expect((await s.profile({ venmoUsername: "", venmoEmail: "only@venmo.test" })).status).toBe(200);
    expect(await json(await request(`${GOOGLE}/payment-profile`, s.org))).toMatchObject({
      venmoUsername: "",
      venmoEmail: "only@venmo.test",
    });
  });

  it("keeps every Venmo account to one person", async () => {
    const s = await scenario({ finalize: false });
    const carol = await approveMember(s, "Carol");
    const org2 = await appoint(carol.id, "carol");
    const taken = async (body: Record<string, unknown>) =>
      (await json(await s.profile(body, org2))).error?.message ?? "ok";
    // Another organizer's, in any case, or the Owner's.
    expect(await taken({ venmoUsername: "alice-v", venmoEmail: "c@venmo.test" })).toMatch(/已经是群主或其他组织者/);
    expect(await taken({ venmoUsername: "carol-v", venmoEmail: "ALICE@venmo.test" })).toMatch(/已经是群主或其他组织者/);
    expect(await taken({ venmoUsername: "keli8916", venmoEmail: "c@venmo.test" })).toMatch(/已经是群主或其他组织者/);
    expect(await taken({ venmoUsername: "carol-v", venmoEmail: "owner@example.com" })).toMatch(
      /已经是群主或其他组织者/,
    );
    expect(await taken({ venmoUsername: "carol-v", venmoEmail: "c@venmo.test" })).toBe("ok");
    // Saving one's own again is fine.
    expect((await s.profile({ venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" })).status).toBe(200);

    // And the Owner can't take an organizer's.
    const res = await s.admin.call(`${s.base}/settings/payment`, { ...ownerPayment, venmoUsername: "Carol-V" });
    expect(res.status).toBe(400);
    const mail = await s.admin.call(`${s.base}/settings/payment`, { ...ownerPayment, venmoEmail: "c@venmo.test" });
    expect(mail.status).toBe(400);
  });

  it("keeps recognizing the old account for 60 days when it changes while bills are out", async () => {
    const s = await scenario();
    const aliases = () => env.DB.prepare("SELECT * FROM payment_aliases").all<Record<string, string>>();
    expect((await json(await request(`${GOOGLE}/payment-profile`, s.org))).outstandingBills).toBe(2);

    // Clearing it would leave the bills with no way to pay.
    const cleared = await s.profile({ venmoUsername: "", venmoEmail: "" });
    expect((await json(cleared)).error.message).toMatch(/还有 2 张账单没收齐/);

    expect((await s.profile({ venmoUsername: "alice-new", venmoEmail: "new@venmo.test" })).status).toBe(200);
    const [alias] = (await aliases()).results;
    expect(alias).toMatchObject({ venmo_username: "Alice-V", venmo_email: "alice@venmo.test", member_id: s.alice.id });
    const days = (Date.parse(alias!.until!) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThanOrEqual(60);
    // Bills point at the new account at once.
    const bill = (await new Client().call(`${s.bob.base}/events`)).data.events[0].payment;
    expect(bill.venmoUsername).toBe("alice-new");

    // Nobody else can take the old one meanwhile, the Owner included.
    const carol = await approveMember(s, "Carol");
    const org2 = await appoint(carol.id, "carol");
    expect((await s.profile({ venmoUsername: "alice-v", venmoEmail: "c@venmo.test" }, org2)).status).toBe(400);
    expect(
      (await s.admin.call(`${s.base}/settings/payment`, { ...ownerPayment, venmoUsername: "Alice-V" })).status,
    ).toBe(400);

    // Going back to it makes it current again rather than an alias.
    expect((await s.profile({ venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" })).status).toBe(200);
    expect((await aliases()).results.map((a) => a.venmo_username)).toEqual(["alice-new"]);
  });

  it("keeps no alias when nothing is still being paid", async () => {
    const s = await scenario({ finalize: false });
    expect((await s.profile({ venmoUsername: "alice-new", venmoEmail: "new@venmo.test" })).status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_aliases").first<{ n: number }>())!.n).toBe(0);
  });

  it("leaves the Owner's own change immediate, with no alias", async () => {
    const s = await scenario();
    expect((await s.admin.call(`${s.base}/settings/payment`, { ...ownerPayment, venmoUsername: "Jay2" })).status).toBe(
      200,
    );
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_aliases").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("the payee is fixed once bills exist", () => {
  it("allows changing it before the first Finalize only", async () => {
    const s = await scenario({ finalize: false });
    await expect(assertPayeeUnlocked(env.DB, s.e.id)).resolves.toBeUndefined();
    await request(`${s.eb}/finalize`, s.org, fees);
    await expect(assertPayeeUnlocked(env.DB, s.e.id)).rejects.toThrow("收款人不能再换");
  });
});
