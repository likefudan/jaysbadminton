import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, approveMember, billingScenario as scenario, createTestEvent, expire, setUpAdmin } from "./helpers";
import { applySettlement, finalize } from "../src/worker/billing";
import { getEvent } from "../src/worker/events";

const anon = new Client();
type Scenario = Awaited<ReturnType<typeof scenario>>;

const payment = async (s: Scenario, name: string) =>
  (await s.admin.call(`${s.eb}/settlement`)).data.payments.find((p: { memberName: string }) => p.memberName === name);

describe("atomic settlement state changes", () => {
  const input = { courtTotalCents: 10000, shuttleCount: 6, shuttlePriceCents: 300 };
  const changed = { ...input, courtTotalCents: 20000 };
  const snapshot = async () =>
    Promise.all(
      ["events", "settlements", "payments", "payment_receipts", "settings", "notification_log"].map((table) =>
        env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all()
          .then((r) => r.results),
      ),
    );

  it("rejects a Finalize whose event was cancelled after it was read, without writing bills", async () => {
    const s = await scenario();
    const stale = await getEvent(env, s.e.id);
    expect((await s.admin.call(`${s.eb}/cancel`, {})).status).toBe(200);
    const before = await snapshot();
    await expect(finalize(env, stale, input)).rejects.toMatchObject({ status: 409, code: "event_changed" });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a Finalize whose event was reopened after it was read", async () => {
    const s = await scenario();
    const stale = await getEvent(env, s.e.id);
    await env.DB.prepare("UPDATE events SET status = 'open' WHERE id = ?").bind(s.e.id).run();
    const before = await snapshot();
    await expect(finalize(env, stale, input)).rejects.toMatchObject({ status: 409, code: "event_changed" });
    expect(await snapshot()).toEqual(before);
  });

  it("neither changes archived bills nor reopens an event collected after it was read", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const stale = await getEvent(env, s.e.id);
    for (const name of ["Alice", "Bob"]) {
      const p = await payment(s, name);
      expect((await s.admin.call(`${s.base}/payments/${p.id}/mark-paid`, {})).status).toBe(200);
    }
    expect((await getEvent(env, s.e.id)).status).toBe("settled");
    const before = await snapshot();
    await expect(finalize(env, stale, changed)).rejects.toMatchObject({ status: 409, code: "event_changed" });
    await expect(applySettlement(env, stale, changed)).rejects.toMatchObject({ status: 409, code: "event_changed" });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back bills, the status transition and remembered price if the Finalize batch fails", async () => {
    const s = await scenario();
    const e = await getEvent(env, s.e.id);
    const before = await snapshot();
    // A runtime constraint failure at the end of the batch simulates a failed commit after
    // writing the bills and event state. Neither can survive on its own.
    const failing = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return (statements: D1PreparedStatement[]) =>
              target.batch([
                ...statements,
                target.prepare("INSERT INTO settings (key, value) VALUES ('test-finalize-failure', NULL)"),
              ]);
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    await expect(finalize(failing, e, input)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("commits bills and finalized state together and claims first Finalize only once", async () => {
    const s = await scenario();
    const stale = await getEvent(env, s.e.id);
    const committedStates: string[] = [];
    const observed = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              const result = await target.batch(statements);
              committedStates.push((await getEvent(env, s.e.id)).status);
              return result;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    expect(await finalize(observed, stale, input)).toBe(true);
    expect(await finalize(observed, stale, input)).toBe(false);
    // No completed batch may leave bills committed while the event still reads closed.
    expect(committedStates).toEqual(["finalized", "finalized"]);
    const e = await getEvent(env, s.e.id);
    expect(e.status).toBe("finalized");
    expect(e.finalized_at).not.toBeNull();
    expect((await payment(s, "Alice")).amountDueCents).toBe(5600);
    expect((await payment(s, "Jay")).receipts).toHaveLength(1);
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_shuttle_price_cents'").first()).toEqual({
      value: "300",
    });
  });
});

describe("settlement", () => {
  it("previews, finalizes and bills each member for themselves and their friends", async () => {
    const s = await scenario();
    const preview = (await s.admin.call(`${s.eb}/preview`, s.fees)).data;
    expect(preview).toMatchObject({ registered: 4, attended: 3, courtShareCents: 2500, shuttleShareCents: 600 });

    expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).status).toBe(200);
    expect(await payment(s, "Alice")).toMatchObject({
      amountDueCents: 3100 + 2500,
      status: "unpaid",
      paymentCode: `alice-jbm${s.e.date.replace(/-/g, "")}-${s.alice.id.toLowerCase()}`,
    });
    expect(await payment(s, "Bob")).toMatchObject({ amountDueCents: 3100, status: "unpaid" });
    expect(await payment(s, "Jay")).toMatchObject({ amountDueCents: 3100, status: "paid", amountPaidCents: 3100 });
    expect((await payment(s, "Jay")).receipts).toMatchObject([{ method: "manual", amountCents: 3100 }]);

    const mine = (await anon.call(`${s.alice.base}/events`)).data.events[0];
    expect(mine.payment).toMatchObject({
      amountCents: 5600,
      status: "unpaid",
      venmoUsername: "KeLi8916",
      zelleAccount: "jay@example.com",
    });
    expect(mine.payment.shares.map((x: { name: string; shuttleCents: number }) => [x.name, x.shuttleCents])).toEqual([
      ["Alice", 600],
      ["Tom", 0],
    ]);
    // The public page shows neither names nor money.
    const pub = (await anon.call(`/api/public/events/${s.e.code}`)).data;
    expect(pub.headcount).toBe(4);
    expect(JSON.stringify(pub)).not.toMatch(/5600|Alice|Bob|Tom/);
  });

  it("refuses to settle before the deadline", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/preview`, {
      courtTotal: "10",
      shuttleCount: 1,
      shuttlePrice: "3",
    });
    expect(res.data.error.message).toBe("报名还没截止，不能结算");
  });

  it("recomputes every bill after Finalize, paid ones included", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const alicePay = await payment(s, "Alice");
    await s.admin.call(`${s.base}/payments/${alicePay.id}/mark-paid`, {});

    // A walk-in hung under Bob: 5 registered, 4 attended. Alice paid 56.00 but now owes 44.50.
    await s.admin.call(`${s.eb}/roster/add`, { memberId: s.bob.id, includeSelf: false, friends: ["路人"] });
    expect(await payment(s, "Alice")).toMatchObject({
      amountDueCents: 2000 + 450 + 2000,
      amountPaidCents: 5600,
      status: "paid",
      refundCents: 1150,
    });
    expect((await payment(s, "Bob")).amountDueCents).toBe(2 * (2000 + 450));

    // Raising the fees later turns her paid bill into a balance due.
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "150" });
    expect((await payment(s, "Bob")).amountDueCents).toBe(2 * (3000 + 450));
    expect(await payment(s, "Alice")).toMatchObject({
      amountDueCents: 3000 + 450 + 3000,
      amountPaidCents: 5600,
      status: "partial",
      refundCents: 0,
    });
  });

  it("keeps the Owner's auto-paid share in step when the fees are corrected", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "200" });
    expect(await payment(s, "Jay")).toMatchObject({
      amountDueCents: 5000 + 600,
      status: "paid",
      amountPaidCents: 5600,
    });

    // The court total was mistyped: everyone, the Owner included, gets the same smaller share.
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const jay = await payment(s, "Jay");
    expect(jay).toMatchObject({ amountDueCents: 3100, status: "paid", amountPaidCents: 3100, refundCents: 0 });
    expect(jay.receipts).toMatchObject([{ method: "manual", amountCents: 3100 }]);
    // That receipt is the system's, not a payment to take back.
    const undo = await s.admin.call(`${s.base}/receipts/${jay.receipts[0].id}/remove`, {});
    expect(undo).toMatchObject({ status: 400 });
    expect(await payment(s, "Jay")).toMatchObject({ status: "paid", amountPaidCents: 3100 });
    expect((await payment(s, "Bob")).amountDueCents).toBe(3100);
    expect((await payment(s, "Alice")).amountDueCents).toBe(3100 + 2500);

    // And back up again.
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "120" });
    expect(await payment(s, "Jay")).toMatchObject({
      amountDueCents: 3000 + 600,
      status: "paid",
      amountPaidCents: 3600,
    });
  });

  it("drops an unpaid bill when the member leaves the roster", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const d = (await s.admin.call(s.eb)).data;
    const bobRow = d.roster.find((r: { name: string }) => r.name === "Bob");
    await s.admin.call(`${s.eb}/roster/${bobRow.id}/remove`, {});
    expect(await payment(s, "Bob")).toBeUndefined();
  });

  it("turns a paid bill into a refund when the member leaves, and drops the Owner's", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await s.admin.call(`${s.base}/payments/${(await payment(s, "Bob")).id}/mark-paid`, {});
    const roster = (await s.admin.call(s.eb)).data.roster;
    for (const name of ["Bob", "Jay"]) {
      await s.admin.call(`${s.eb}/roster/${roster.find((r: { name: string }) => r.name === name).id}/remove`, {});
    }
    expect(await payment(s, "Bob")).toMatchObject({
      amountDueCents: 0,
      amountPaidCents: 3100,
      status: "paid",
      refundCents: 3100,
    });
    expect(await payment(s, "Jay")).toBeUndefined();
  });

  it("keeps a removed member's bill when its payments were refunded in full", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const bob = await payment(s, "Bob");
    // Bob's Venmo payment came in through 待确认 and was linked to his bill by hand.
    await env.DB.prepare(
      `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind, reason)
       VALUES ('txn-bob', 'Bob Li', 3100, 'badminton', ?, 'unmatched', 'test')`,
    )
      .bind(new Date().toISOString())
      .run();
    const inbound = (await s.admin.call(`${s.base}/inbound`)).data.open[0];
    expect((await s.admin.call(`${s.base}/inbound/${inbound.id}/link`, { paymentId: bob.id })).status).toBe(200);
    const bobRow = async () =>
      (await s.admin.call(s.eb)).data.roster.find((r: { name: string }) => r.name === "Bob").id;
    // He leaves, is refunded in full (so the bill nets to nothing received), comes back and leaves again.
    await s.admin.call(`${s.eb}/roster/${await bobRow()}/remove`, {});
    expect((await s.admin.call(`${s.base}/payments/${bob.id}/refunded`, {})).status).toBe(200);
    await s.admin.call(`${s.eb}/roster/add`, { memberId: s.bob.id, includeSelf: true, friends: [] });
    expect(await payment(s, "Bob")).toMatchObject({ amountDueCents: 3100, amountPaidCents: 0, status: "unpaid" });
    expect((await s.admin.call(`${s.eb}/roster/${await bobRow()}/remove`, {})).status).toBe(200);
    expect(await payment(s, "Bob")).toMatchObject({ amountDueCents: 0, amountPaidCents: 0, status: "paid" });
    expect((await payment(s, "Bob")).receipts.map((r: { amountCents: number }) => r.amountCents)).toEqual([
      3100, -3100,
    ]);
  });

  it("leaves only the Owner's Venmo payment to refund when the Owner leaves", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const jay = await payment(s, "Jay");
    // The Owner paid their own bill by Venmo with its code, so it was matched automatically.
    await env.DB.prepare(
      `INSERT INTO payment_receipts (payment_id, amount_cents, method, venmo_txn_id, payer_name, received_at)
       VALUES (?, 500, 'venmo', 'txn-jay', 'Jay', ?)`,
    )
      .bind(jay.id, new Date().toISOString())
      .run();
    const row = (await s.admin.call(s.eb)).data.roster.find((r: { name: string }) => r.name === "Jay").id;
    expect((await s.admin.call(`${s.eb}/roster/${row}/remove`, {})).status).toBe(200);
    expect(await payment(s, "Jay")).toMatchObject({ amountDueCents: 0, amountPaidCents: 500, refundCents: 500 });
    // Back on the list: the Venmo payment stays and the manual receipt covers only the rest.
    await s.admin.call(`${s.eb}/roster/add`, { memberId: s.owner, includeSelf: true, friends: [] });
    const back = await payment(s, "Jay");
    expect(back).toMatchObject({ amountPaidCents: back.amountDueCents, status: "paid", refundCents: 0 });
    expect(back.receipts.map((r: { method: string; amountCents: number }) => [r.method, r.amountCents])).toEqual([
      ["venmo", 500],
      ["manual", back.amountDueCents - 500],
    ]);
  });

  it("refuses roster changes after Finalize that would leave the fees unshared", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const roster = (await s.admin.call(s.eb)).data.roster as { id: number; name: string; attended: boolean }[];
    const present = roster.filter((r) => r.attended);
    for (const r of present.slice(0, -1))
      expect((await s.admin.call(`${s.eb}/attendance`, { registrationId: r.id, attended: false })).status).toBe(200);
    const last = present.at(-1)!;
    const refused = await s.admin.call(`${s.eb}/attendance`, { registrationId: last.id, attended: false });
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toContain("球费没人分摊");
    expect((await s.admin.call(s.eb)).data.roster.find((r: { id: number }) => r.id === last.id).attended).toBe(true);
    // Removing the last one who came is the same thing.
    expect((await s.admin.call(`${s.eb}/roster/${last.id}/remove`, {})).status).toBe(400);

    // With no shuttles to share, nobody attending is fine; emptying the list still is not.
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, shuttleCount: 0 });
    expect((await s.admin.call(`${s.eb}/attendance`, { registrationId: last.id, attended: false })).status).toBe(200);
    const ids = (await s.admin.call(s.eb)).data.roster.map((r: { id: number }) => r.id) as number[];
    for (const id of ids.slice(0, -1)) expect((await s.admin.call(`${s.eb}/roster/${id}/remove`, {})).status).toBe(200);
    const emptied = await s.admin.call(`${s.eb}/roster/${ids.at(-1)}/remove`, {});
    expect(emptied.data.error.message).toContain("名单删空");
    expect((await s.admin.call(s.eb)).data.status).toBe("finalized");
  });

  it("keeps billing a removed member for the friends they brought", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await s.admin.call(`${s.base}/payments/${(await payment(s, "Alice")).id}/mark-paid`, {});
    const roster = (await s.admin.call(s.eb)).data.roster;
    await s.admin.call(`${s.eb}/roster/${roster.find((r: { name: string }) => r.name === "Alice").id}/remove`, {});
    // Tom stays, absent, on Alice's bill: 3 registered share the court, 2 attended share the shuttles.
    expect((await s.admin.call(s.eb)).data.roster.map((r: { name: string }) => r.name).sort()).toEqual([
      "Bob",
      "Jay",
      "Tom",
    ]);
    expect(await payment(s, "Alice")).toMatchObject({
      amountDueCents: 3334,
      amountPaidCents: 5600,
      refundCents: 5600 - 3334,
    });
    expect((await payment(s, "Bob")).amountDueCents).toBe(3334 + 900);
  });

  it("asks for the difference again when a bill goes back up after a refund", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const a = await payment(s, "Alice");
    await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {});
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "80" });
    expect(await payment(s, "Alice")).toMatchObject({ amountDueCents: 2000 + 600 + 2000, refundCents: 1000 });
    expect((await s.admin.call(`${s.base}/payments/${a.id}/refunded`, {})).status).toBe(200);
    expect(await payment(s, "Alice")).toMatchObject({ amountPaidCents: 4600, status: "paid", refundCents: 0 });
    expect((await s.admin.call(`${s.base}/payments/${a.id}/refunded`, {})).status).toBe(400);

    await s.admin.call(`${s.eb}/finalize`, s.fees);
    expect(await payment(s, "Alice")).toMatchObject({ amountDueCents: 5600, amountPaidCents: 4600, status: "partial" });
    await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {});
    expect(await payment(s, "Alice")).toMatchObject({ amountPaidCents: 5600, status: "paid", refundCents: 0 });
    expect((await payment(s, "Alice")).receipts.map((r: { amountCents: number }) => r.amountCents)).toEqual([
      5600, -1000, 1000,
    ]);
    expect((await payment(s, "Alice")).receipts.map((r: { method: string }) => r.method)).toEqual([
      "manual",
      "refund",
      "manual",
    ]);
  });
});

describe("a long run of corrections after Finalize", () => {
  interface Pay {
    id: number;
    memberName: string;
    isPayee: boolean;
    amountDueCents: number;
    amountPaidCents: number;
    refundCents: number;
    status: string;
    receipts: { amountCents: number; method: string }[];
  }

  // Many sequential D1 requests exercise the full correction history, rather than one operation.
  it("keeps every bill fair through 3 raises, 3 cuts, an absence and two removals", async () => {
    const s = await scenario();
    const carol = await approveMember(s, "Carol");
    await s.admin.call(`${s.eb}/roster/add`, { memberId: carol.id, includeSelf: true, friends: ["Dan"] });
    // Jay (Owner), Alice + Tom (absent), Bob, Carol + Dan: 6 registered, 5 attended.

    const rosterId = async (name: string) =>
      (await s.admin.call(s.eb)).data.roster.find((r: { name: string }) => r.name === name).id;
    const pays = async (): Promise<Record<string, Pay>> =>
      Object.fromEntries((await s.admin.call(`${s.eb}/settlement`)).data.payments.map((p: Pay) => [p.memberName, p]));
    const fees = (courtTotal: string, shuttleCount: number, shuttlePrice: string) =>
      s.admin.call(`${s.eb}/finalize`, { courtTotal, shuttleCount, shuttlePrice });
    const markPaid = async (name: string) =>
      s.admin.call(`${s.base}/payments/${(await pays())[name]!.id}/mark-paid`, {});
    const refunded = async (name: string) =>
      s.admin.call(`${s.base}/payments/${(await pays())[name]!.id}/refunded`, {});

    /** Each bill is due what the split says, and its paid total and status follow from its own records. */
    async function expectBills(step: string, due: Record<string, number>, net: Record<string, number>) {
      const all = await pays();
      expect(Object.keys(all).sort(), step).toEqual(Object.keys(due).sort());
      for (const [name, p] of Object.entries(all)) {
        const sum = p.receipts.reduce((t, r) => t + r.amountCents, 0);
        expect([name, p.amountDueCents, p.amountPaidCents], step).toEqual([name, due[name], net[name] ?? 0]);
        expect(p.amountPaidCents, `${step}: ${name}'s records`).toBe(sum);
        expect(p.refundCents, `${step}: ${name}'s refund`).toBe(Math.max(0, sum - p.amountDueCents));
        const status = sum >= p.amountDueCents ? "paid" : sum > 0 ? "partial" : "unpaid";
        expect(p.status, `${step}: ${name}'s status`).toBe(status);
        if (p.isPayee)
          expect(p.receipts, `${step}: Owner pays exactly their share`).toMatchObject([
            { method: "manual", amountCents: p.amountDueCents },
          ]);
      }
    }

    // Court 120 / 6 = 20.00; shuttles 10 × 3 / 5 = 6.00.
    await fees("120", 10, "3");
    await markPaid("Alice");
    await markPaid("Bob");
    await expectBills(
      "start",
      { Jay: 2600, Alice: 4600, Bob: 2600, Carol: 5200 },
      { Jay: 2600, Alice: 4600, Bob: 2600 },
    );

    // Raise 1: court 150 / 6 = 25.00. Alice and Bob now owe the difference.
    await fees("150", 10, "3");
    await expectBills(
      "raise 1",
      { Jay: 3100, Alice: 5600, Bob: 3100, Carol: 6200 },
      { Jay: 3100, Alice: 4600, Bob: 2600 },
    );

    // Cut 1: court 90 / 6 = 15.00. Alice and Bob are over; Alice gets her 10.00 back.
    await fees("90", 10, "3");
    await expectBills(
      "cut 1",
      { Jay: 2100, Alice: 3600, Bob: 2100, Carol: 4200 },
      { Jay: 2100, Alice: 4600, Bob: 2600 },
    );
    expect((await refunded("Alice")).status).toBe(200);
    await expectBills(
      "refund Alice",
      { Jay: 2100, Alice: 3600, Bob: 2100, Carol: 4200 },
      { Jay: 2100, Alice: 3600, Bob: 2600 },
    );

    // Dan did not come: shuttles 30 / 4 = 7.50.
    await s.admin.call(`${s.eb}/attendance`, { registrationId: await rosterId("Dan"), attended: false });
    await expectBills(
      "Dan absent",
      { Jay: 2250, Alice: 3750, Bob: 2250, Carol: 3750 },
      { Jay: 2250, Alice: 3600, Bob: 2600 },
    );

    // Raise 2: 12 shuttles, 36 / 4 = 9.00. Alice pays the rest.
    await fees("90", 12, "3");
    await expectBills(
      "raise 2",
      { Jay: 2400, Alice: 3900, Bob: 2400, Carol: 3900 },
      { Jay: 2400, Alice: 3600, Bob: 2600 },
    );
    await markPaid("Alice");

    // Bob is removed: he owes nothing, so all 26.00 is his refund. Court 90 / 5 = 18.00, shuttles 36 / 3 = 12.00.
    await s.admin.call(`${s.eb}/roster/${await rosterId("Bob")}/remove`, {});
    await expectBills(
      "Bob removed",
      { Jay: 3000, Alice: 4800, Bob: 0, Carol: 4800 },
      { Jay: 3000, Alice: 3900, Bob: 2600 },
    );

    // Cut 2: court 75 / 5 = 15.00, shuttles 12 × 2.50 / 3 = 10.00.
    await fees("75", 12, "2.5");
    await expectBills("cut 2", { Jay: 2500, Alice: 4000, Bob: 0, Carol: 4000 }, { Jay: 2500, Alice: 3900, Bob: 2600 });

    // Raise 3: court 100 / 5 = 20.00. Carol pays in full.
    await fees("100", 12, "2.5");
    await expectBills(
      "raise 3",
      { Jay: 3000, Alice: 5000, Bob: 0, Carol: 5000 },
      { Jay: 3000, Alice: 3900, Bob: 2600 },
    );
    await markPaid("Carol");

    // Alice is removed but Tom stays on her bill. Court 100 / 4 = 25.00, shuttles 30 / 2 = 15.00.
    await s.admin.call(`${s.eb}/roster/${await rosterId("Alice")}/remove`, {});
    await expectBills(
      "Alice removed",
      { Jay: 4000, Alice: 2500, Bob: 0, Carol: 6500 },
      { Jay: 4000, Alice: 3900, Bob: 2600, Carol: 5000 },
    );

    // Cut 3: court 60 / 4 = 15.00, 10 shuttles 25 / 2 = 12.50. Everyone has now paid enough, so it archives.
    await fees("60", 10, "2.5");
    await expectBills(
      "cut 3",
      { Jay: 2750, Alice: 1500, Bob: 0, Carol: 4250 },
      { Jay: 2750, Alice: 3900, Bob: 2600, Carol: 5000 },
    );
    expect((await s.admin.call(s.eb)).data.status).toBe("settled");

    // The refunds are still recorded on the archived event, one entry each.
    for (const name of ["Alice", "Bob", "Carol"]) expect((await refunded(name)).status).toBe(200);
    await expectBills(
      "refunds",
      { Jay: 2750, Alice: 1500, Bob: 0, Carol: 4250 },
      { Jay: 2750, Alice: 1500, Bob: 0, Carol: 4250 },
    );
    const p = await pays();
    expect(p.Alice!.receipts.map((r) => [r.method, r.amountCents])).toEqual([
      ["manual", 4600],
      ["refund", -1000],
      ["manual", 300],
      ["refund", -2400],
    ]);
    expect(p.Bob!.receipts.map((r) => [r.method, r.amountCents])).toEqual([
      ["manual", 2600],
      ["refund", -2600],
    ]);
    expect(p.Carol!.receipts.map((r) => [r.method, r.amountCents])).toEqual([
      ["manual", 5000],
      ["refund", -750],
    ]);
    // After the refunds, what the group kept is exactly the 60.00 court and 25.00 shuttles.
    const kept = Object.values(p).reduce((t, x) => t + x.amountPaidCents, 0);
    expect(kept).toBe(6000 + 2500);
  }, 20_000);
});

describe("collection and archive", () => {
  it("a repeated 标记已付 (two tabs, a retry) records the money once", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const a = await payment(s, "Alice");
    const results = await Promise.all([1, 2].map(() => s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await payment(s, "Alice")).toMatchObject({ status: "paid", amountPaidCents: a.amountDueCents });
    expect((await payment(s, "Alice")).receipts).toHaveLength(1);
  });

  it("archives the moment everyone is paid, then locks the event", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const a = await payment(s, "Alice");
    const b = await payment(s, "Bob");
    expect((await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {})).data.settled).toBe(false);
    const receipt = (await payment(s, "Alice")).receipts[0];
    await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {});
    expect(await payment(s, "Alice")).toMatchObject({ status: "unpaid", amountPaidCents: 0, receipts: [] });
    await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {});
    expect((await s.admin.call(`${s.base}/payments/${b.id}/mark-paid`, {})).data.settled).toBe(true);

    const ev = (await s.admin.call(s.eb)).data;
    expect(ev.status).toBe("settled");
    const add = await s.admin.call(`${s.eb}/roster/add`, { memberId: s.bob.id, includeSelf: false, friends: ["x"] });
    expect(add.data.error.message).toBe("这个活动已收齐归档，不能再修改");
    const paid = (await payment(s, "Alice")).receipts[0];
    expect((await s.admin.call(`${s.base}/receipts/${paid.id}/remove`, {})).data.error.message).toBe(
      "这个活动已收齐归档，只能撤销多付的 Venmo 付款",
    );
    expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).data.error.message).toBe("这个活动已收齐归档，不能再修改");

    const home = (await anon.call("/api/public/home")).data;
    expect(home.pastEvents[0].status).toBe("settled");
    const mine = (await anon.call(`${s.bob.base}/events`)).data.events[0];
    expect(mine.payment.status).toBe("paid");
  });

  it("archives immediately when only the Owner owes anything", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, {
      memberId: owner,
      includeSelf: true,
      friends: ["朋友"],
    });
    await expire(e.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, {
      courtTotal: "50",
      shuttleCount: 2,
      shuttlePrice: "3",
    });
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.status).toBe("settled");
  });

  it("validates fee inputs", async () => {
    const s = await scenario();
    const bad = await s.admin.call(`${s.eb}/finalize`, { courtTotal: "abc", shuttleCount: 1, shuttlePrice: "3" });
    expect(bad.data.error.message).toBe("请填写场地总费用（美元）");
    const typo = await s.admin.call(`${s.eb}/preview`, { ...s.fees, courtTotal: "5000.01" });
    expect(typo.data.error.message).toContain("场地总费用超过 $5000.00");
    const shuttle = await s.admin.call(`${s.eb}/finalize`, { ...s.fees, shuttlePrice: "30" });
    expect(shuttle.data.error.message).toContain("羽毛球单价超过 $20.00");
    expect((await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "5000", shuttlePrice: "20" })).status).toBe(
      200,
    );
  });
});
