import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { syncPayments } from "../src/worker/billing";
import { paymentCode } from "../src/worker/paymentCode";
import { approveMember, billingScenario } from "./helpers";

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

interface State {
  fees: [string, number, string];
  due: Record<string, number>;
  net: Record<string, number>;
  receipts: Record<string, number[]>;
  removed: string[];
  danAbsent: boolean;
  archived: boolean;
}

// Literal checkpoints from the original full correction history. Each test restores only its
// starting state into real D1 and exercises the next operation through the API. No earlier API
// sequence is replayed, and expected amounts are not calculated with the production splitter.
const start: State = {
  fees: ["120", 10, "3"],
  due: { Jay: 2600, Alice: 4600, Bob: 2600, Carol: 5200 },
  net: { Jay: 2600, Alice: 4600, Bob: 2600 },
  receipts: { Alice: [4600], Bob: [2600] },
  removed: [],
  danAbsent: false,
  archived: false,
};
const raise1: State = {
  ...start,
  fees: ["150", 10, "3"],
  due: { Jay: 3100, Alice: 5600, Bob: 3100, Carol: 6200 },
  net: { Jay: 3100, Alice: 4600, Bob: 2600 },
};
const cut1: State = {
  ...raise1,
  fees: ["90", 10, "3"],
  due: { Jay: 2100, Alice: 3600, Bob: 2100, Carol: 4200 },
  net: { Jay: 2100, Alice: 4600, Bob: 2600 },
};
const refundAlice: State = {
  ...cut1,
  net: { Jay: 2100, Alice: 3600, Bob: 2600 },
  receipts: { Alice: [4600, -1000], Bob: [2600] },
};
const danAbsent: State = {
  ...refundAlice,
  danAbsent: true,
  due: { Jay: 2250, Alice: 3750, Bob: 2250, Carol: 3750 },
  net: { Jay: 2250, Alice: 3600, Bob: 2600 },
};
const raise2: State = {
  ...danAbsent,
  fees: ["90", 12, "3"],
  due: { Jay: 2400, Alice: 3900, Bob: 2400, Carol: 3900 },
  net: { Jay: 2400, Alice: 3600, Bob: 2600 },
};
const paidAlice: State = {
  ...raise2,
  net: { Jay: 2400, Alice: 3900, Bob: 2600 },
  receipts: { Alice: [4600, -1000, 300], Bob: [2600] },
};
const removedBob: State = {
  ...paidAlice,
  removed: ["Bob"],
  due: { Jay: 3000, Alice: 4800, Bob: 0, Carol: 4800 },
  net: { Jay: 3000, Alice: 3900, Bob: 2600 },
};
const cut2: State = {
  ...removedBob,
  fees: ["75", 12, "2.5"],
  due: { Jay: 2500, Alice: 4000, Bob: 0, Carol: 4000 },
  net: { Jay: 2500, Alice: 3900, Bob: 2600 },
};
const raise3: State = {
  ...cut2,
  fees: ["100", 12, "2.5"],
  due: { Jay: 3000, Alice: 5000, Bob: 0, Carol: 5000 },
  net: { Jay: 3000, Alice: 3900, Bob: 2600 },
};
const paidCarol: State = {
  ...raise3,
  net: { Jay: 3000, Alice: 3900, Bob: 2600, Carol: 5000 },
  receipts: { ...paidAlice.receipts, Carol: [5000] },
};
const removedAlice: State = {
  ...paidCarol,
  removed: ["Bob", "Alice"],
  due: { Jay: 4000, Alice: 2500, Bob: 0, Carol: 6500 },
  net: { Jay: 4000, Alice: 3900, Bob: 2600, Carol: 5000 },
};
const cut3: State = {
  ...removedAlice,
  fees: ["60", 10, "2.5"],
  due: { Jay: 2750, Alice: 1500, Bob: 0, Carol: 4250 },
  net: { Jay: 2750, Alice: 3900, Bob: 2600, Carol: 5000 },
  archived: true,
};
const refunded: State = {
  ...cut3,
  net: { Jay: 2750, Alice: 1500, Bob: 0, Carol: 4250 },
  receipts: { Alice: [4600, -1000, 300, -2400], Bob: [2600, -2600], Carol: [5000, -750] },
};

type Context = Awaited<ReturnType<typeof billingScenario>>;
const pays = async (s: Context): Promise<Record<string, Pay>> =>
  Object.fromEntries((await s.admin.call(`${s.eb}/settlement`)).data.payments.map((p: Pay) => [p.memberName, p]));
const fees = (s: Context, state: State) => {
  const [courtTotal, shuttleCount, shuttlePrice] = state.fees;
  return s.admin.call(`${s.eb}/finalize`, { courtTotal, shuttleCount, shuttlePrice });
};
const payAction = async (s: Context, name: string, action: "mark-paid" | "refunded") =>
  s.admin.call(`${s.base}/payments/${(await pays(s))[name]!.id}/${action}`, {});
const rosterId = async (s: Context, name: string) =>
  (await s.admin.call(s.eb)).data.roster.find((r: { name: string }) => r.name === name).id;

async function expectBills(s: Context, state: State) {
  const all = await pays(s);
  expect(Object.keys(all).sort()).toEqual(Object.keys(state.due).sort());
  for (const [name, p] of Object.entries(all)) {
    const net = state.net[name] ?? 0;
    expect([name, p.amountDueCents, p.amountPaidCents]).toEqual([name, state.due[name], net]);
    expect(
      p.receipts.reduce((sum, r) => sum + r.amountCents, 0),
      `${name}'s records`,
    ).toBe(net);
    expect(p.refundCents, `${name}'s refund`).toBe(Math.max(0, net - p.amountDueCents));
    expect(p.status, `${name}'s status`).toBe(net >= p.amountDueCents ? "paid" : net > 0 ? "partial" : "unpaid");
    expect(
      p.receipts.map((r) => [r.method, r.amountCents]),
      `${name}'s receipt history`,
    ).toEqual(
      p.isPayee
        ? [["manual", p.amountDueCents]]
        : (state.receipts[name] ?? []).map((amount) => [amount < 0 ? "refund" : "manual", amount]),
    );
  }
  expect((await s.admin.call(s.eb)).data.status).toBe(state.archived ? "settled" : "finalized");
}

async function players() {
  const s = await billingScenario();
  const carol = await approveMember(s, "Carol");
  expect(
    (await s.admin.call(`${s.eb}/roster/add`, { memberId: carol.id, includeSelf: true, friends: ["Dan"] })).status,
  ).toBe(200);
  return { ...s, carol };
}

async function restore(state: State) {
  const s = await players();
  const ids: Record<string, string> = { Jay: s.owner, Alice: s.alice.id, Bob: s.bob.id, Carol: s.carol.id };
  await env.DB.batch([
    ...state.removed.map((name) =>
      env.DB.prepare("DELETE FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index = 0").bind(
        s.e.id,
        ids[name],
      ),
    ),
    env.DB.prepare("UPDATE registrations SET attended = ? WHERE event_id = ? AND friend_name = 'Dan'").bind(
      state.danAbsent ? 0 : 1,
      s.e.id,
    ),
  ]);
  expect((await fees(s, state)).status).toBe(200);

  const existing = await pays(s);
  const statements: D1PreparedStatement[] = [];
  for (const [name, amounts] of Object.entries(state.receipts)) {
    // Bob's old paid bill remains at zero after he leaves the roster. Finalize cannot create
    // it from today's roster, so restore that historical row as well as its payment records.
    if (!existing[name])
      statements.push(
        env.DB.prepare(
          "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status) VALUES (?, ?, ?, ?, 'unpaid')",
        ).bind(s.e.id, ids[name], state.due[name], paymentCode(name, await getNumber(s.e.id), ids[name]!)),
      );
    for (const [index, amount] of amounts.entries())
      statements.push(
        env.DB.prepare(
          `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
           SELECT id, ?, ?, ? FROM payments WHERE event_id = ? AND member_id = ?`,
        ).bind(
          amount,
          amount < 0 ? "refund" : "manual",
          new Date(1_700_000_000_000 + index * 1000).toISOString(),
          s.e.id,
          ids[name],
        ),
      );
  }
  statements.push(
    ...syncPayments(env.DB, "event_id = ?", s.e.id),
    env.DB.prepare("UPDATE events SET status = ?, settled_at = ? WHERE id = ?").bind(
      state.archived ? "settled" : "finalized",
      state.archived ? new Date().toISOString() : null,
      s.e.id,
    ),
  );
  await env.DB.batch(statements);
  await expectBills(s, state); // Validate the fixture before testing the transition.
  return s;
}

async function getNumber(id: number) {
  return (await env.DB.prepare("SELECT number FROM events WHERE id = ?").bind(id).first<{ number: string }>())!.number;
}

const corrections = [
  { name: "raise 1", before: start, after: raise1, action: (s: Context) => fees(s, raise1) },
  { name: "cut 1", before: raise1, after: cut1, action: (s: Context) => fees(s, cut1) },
  { name: "refund Alice", before: cut1, after: refundAlice, action: (s: Context) => payAction(s, "Alice", "refunded") },
  {
    name: "Dan absent",
    before: refundAlice,
    after: danAbsent,
    action: async (s: Context) =>
      s.admin.call(`${s.eb}/attendance`, { registrationId: await rosterId(s, "Dan"), attended: false }),
  },
  { name: "raise 2", before: danAbsent, after: raise2, action: (s: Context) => fees(s, raise2) },
  {
    name: "Alice pays the difference",
    before: raise2,
    after: paidAlice,
    action: (s: Context) => payAction(s, "Alice", "mark-paid"),
  },
  {
    name: "Bob removed",
    before: paidAlice,
    after: removedBob,
    action: async (s: Context) => s.admin.call(`${s.eb}/roster/${await rosterId(s, "Bob")}/remove`, {}),
  },
  { name: "cut 2", before: removedBob, after: cut2, action: (s: Context) => fees(s, cut2) },
  { name: "raise 3", before: cut2, after: raise3, action: (s: Context) => fees(s, raise3) },
  { name: "Carol pays", before: raise3, after: paidCarol, action: (s: Context) => payAction(s, "Carol", "mark-paid") },
  {
    name: "Alice removed but Tom stays",
    before: paidCarol,
    after: removedAlice,
    action: async (s: Context) => s.admin.call(`${s.eb}/roster/${await rosterId(s, "Alice")}/remove`, {}),
  },
  { name: "cut 3 archives the event", before: removedAlice, after: cut3, action: (s: Context) => fees(s, cut3) },
];

describe("independent corrections after Finalize", () => {
  it("creates the starting bills and records Alice and Bob's initial payments", async () => {
    const s = await players();
    expect((await fees(s, start)).status).toBe(200);
    for (const name of ["Alice", "Bob"]) expect((await payAction(s, name, "mark-paid")).status).toBe(200);
    await expectBills(s, start);
  });

  it.each(corrections)("$name", async ({ before, after, action }) => {
    const s = await restore(before);
    expect((await action(s)).status).toBe(200);
    await expectBills(s, after);
  });

  it("records all refunds on the archived event, preserving the entire receipt history", async () => {
    const s = await restore(cut3);
    for (const name of ["Alice", "Bob", "Carol"]) expect((await payAction(s, name, "refunded")).status).toBe(200);
    await expectBills(s, refunded);
    const kept = Object.values(await pays(s)).reduce((sum, p) => sum + p.amountPaidCents, 0);
    expect(kept).toBe(6000 + 2500);
  });
});
