import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { KeyLookupError, verifyDkim } from "../src/worker/email/dkim";
import { htmlLines, parseEmail, receiptSubjectAmount } from "../src/worker/email/parse";
import { handleEmail } from "../src/worker/inbound";
import { Client, billingScenario, createTestEvent, futureDate } from "./helpers";
import { receiptHtml, testKey, venmoEmail, type ReceiptFields } from "./venmoMail";

let resolveKey: Awaited<ReturnType<typeof testKey>>["resolveKey"];
beforeAll(async () => {
  resolveKey = (await testKey()).resolveKey;
});

const deliver = async (fields: ReceiptFields, opts?: Parameters<typeof venmoEmail>[1]) =>
  handleEmail(env, (await venmoEmail(fields, opts)).raw, { resolveKey });

async function finalized() {
  const s = await billingScenario();
  await s.admin.call(`${s.eb}/finalize`, s.fees);
  const { payments } = (await s.admin.call(`${s.eb}/settlement`)).data;
  const by = (name: string) => payments.find((p: { memberName: string }) => p.memberName === name);
  return {
    ...s,
    aliceCode: by("Alice").paymentCode as string,
    bobCode: by("Bob").paymentCode as string,
    by: async (name: string) =>
      (await s.admin.call(`${s.eb}/settlement`)).data.payments.find(
        (p: { memberName: string }) => p.memberName === name,
      ),
  };
}

describe("receipt parsing", () => {
  it("reads every field from the HTML layout, joining the split amount", async () => {
    const { raw } = await venmoEmail({
      payer: "Yue sun",
      amount: "1,234.50",
      note: "Milktea9/27",
      txnId: "77B44894RT023271X",
    });
    const mail = await parseEmail(raw);
    expect(mail.fromAddress).toBe("venmo@venmo.com");
    expect(mail.receipt).toEqual({
      payer: "Yue sun",
      amountCents: 123450,
      note: "Milktea9/27",
      date: "Sep 28, 2026",
      txnId: "77B44894RT023271X",
      sentTo: "KeLi8916",
    });
  });

  it("decodes entities and returns null when a field is missing", () => {
    const html = receiptHtml({
      payer: "A",
      amount: "7.00",
      note: "Tom &amp; Jerry&#39;s",
      txnId: "X1",
      sentTo: "me",
      from: "",
      to: "",
    });
    expect(htmlLines(html)).toContain("Tom & Jerry's");
    const noTxn = html.replace("<h3>Transaction ID</h3>", "");
    expect(htmlLines(noTxn)).not.toContain("Transaction ID");
  });
});

describe("receipt subject", () => {
  it("accepts both Venmo receipt titles and nothing else", () => {
    expect(receiptSubjectAmount("Alice W paid $7.00 to your Venmo account. Leave it in Venmo or transfer it")).toBe(
      "$7.00",
    );
    expect(receiptSubjectAmount("Alice W paid you $1,234.50")).toBe("$1,234.50");
    expect(receiptSubjectAmount("Alice W paid you $7.00.")).toBe("$7.00");
    expect(receiptSubjectAmount("You paid Alice W $7.00")).toBeNull();
    expect(receiptSubjectAmount("Alice W requests $7.00")).toBeNull();
    expect(receiptSubjectAmount("Venmo newsletter")).toBeNull();
  });
});

describe("DKIM", () => {
  it("accepts Venmo's signature through forwarding headers", async () => {
    expect(await verifyDkim((await venmoEmail()).raw, "venmo.com", resolveKey)).toEqual({ ok: true });
  });

  it("rejects an edited note, an edited subject, a missing signature and a second From", async () => {
    const cases = [
      { tamper: (r: string) => r.replace("Badminton", "Badmintom") },
      { tamper: (r: string) => r.replace("paid $56.00", "paid $5.00") },
      { sign: false },
      { tamper: (r: string) => `From: Venmo <venmo@venmo.com>\r\n${r}` },
      { tamper: (r: string) => `To: owner@example.com\r\n${r}` },
    ];
    for (const opts of cases)
      expect((await verifyDkim((await venmoEmail({}, opts)).raw, "venmo.com", resolveKey)).ok).toBe(false);
  });

  it("drops forged and unrelated mail", async () => {
    const s = await finalized();
    expect(await deliver({ note: s.aliceCode }, { sign: false })).toBe("bad_signature");
    expect(await deliver({ note: s.aliceCode, from: "Venmo <venmo@evil.example>" })).toBe("not_venmo");
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid" });
  });
});

const inboundCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM inbound_payments").first<{ n: number }>())!.n;

describe("matching", () => {
  it("marks the exact amount paid, ignores the same transaction twice, and archives when collected", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "56.00", note: `badminton ${s.aliceCode}`, txnId: "T1" })).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 5600, refundCents: 0 });
    expect((await s.by("Alice")).receipts).toMatchObject([
      { method: "venmo", amountCents: 5600, payerName: "Alice W" },
    ]);
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T1" })).toBe("duplicate");

    // Case and stray spaces are tolerated.
    const loose = s.bobCode.replace("-m", " - M").toUpperCase();
    expect(await deliver({ amount: "31.00", note: loose, txnId: "T2" })).toBe("paid");
    expect((await s.admin.call(s.eb)).data.status).toBe("settled");
  });

  it('matches a receipt titled "X paid you $N"', async () => {
    const s = await finalized();
    const opts = { subject: "Alice W paid you $56.00" };
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T9" }, opts)).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 5600 });
    // The title and body amounts must still agree.
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "T10" }, { subject: "Bob paid you $3.00" })).toBe(
      "parse_failed",
    );
  });

  it("sends a payment for a deleted event to 待确认, never to a new event on the same day", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "D1" })).toBe("paid");
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "D2" })).toBe("paid");
    expect((await s.admin.call(`${s.eb}/delete`, { password: "initial-password" })).status).toBe(200);
    const next = await createTestEvent(s, { date: s.e.date });
    expect(next.code).toBe(`${s.e.code}B`);

    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "D3" })).toBe("review");
    const { open } = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(open).toMatchObject([{ reason: "这次活动已从数据库永久删除" }]);
  });

  it("adds up partial payments until the bill is paid", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "20.00", note: s.aliceCode, txnId: "P1" })).toBe("partial");
    expect(await s.by("Alice")).toMatchObject({ status: "partial", amountPaidCents: 2000 });
    const me = async () => (await new Client().call(`${s.alice.base}/events`)).data.events[0].payment;
    expect(await me()).toMatchObject({ status: "partial", amountCents: 5600, paidCents: 2000 });

    expect(await deliver({ amount: "30.00", note: s.aliceCode, txnId: "P2" })).toBe("partial");
    expect(await deliver({ amount: "6.00", note: s.aliceCode, txnId: "P3" })).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 5600, refundCents: 0 });
    expect((await s.by("Alice")).receipts.map((r: { amountCents: number }) => r.amountCents)).toEqual([
      2000, 3000, 600,
    ]);
  });

  it("counts an over-payment, or paying twice, as paid and lists the refund", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "60.00", note: s.aliceCode, txnId: "O1" })).toBe("overpaid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 6000, refundCents: 400 });

    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "O2" })).toBe("paid");
    expect((await s.admin.call(s.eb)).data.status).toBe("settled");
    // Paying again after the event is archived still lands on the bill, as a refund.
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "O3" })).toBe("overpaid");
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "O3" })).toBe("duplicate");

    const { refunds, open } = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(open).toEqual([]);
    expect(
      refunds.map((r: { memberName: string; refundCents: number }) => [r.memberName, r.refundCents]).sort(),
    ).toEqual([
      ["Alice", 400],
      ["Bob", 3100],
    ]);
    const bob = refunds.find((r: { memberName: string }) => r.memberName === "Bob");
    expect(bob).toMatchObject({ amountDueCents: 3100, amountPaidCents: 6200 });
    expect(bob.receipts).toHaveLength(2);
    expect((await new Client().call(`${s.bob.base}/events`)).data.events[0].payment.refundCents).toBe(3100);

    expect((await s.admin.call(`${s.base}/payments/${bob.paymentId}/refunded`, {})).status).toBe(200);
    expect((await s.admin.call(`${s.base}/payments/${bob.paymentId}/refunded`, {})).status).toBe(400);
    expect(
      (await s.admin.call(`${s.base}/inbound`)).data.refunds.map((r: { memberName: string }) => r.memberName),
    ).toEqual(["Alice"]);
  });

  it("asks the Owner when the event is ours but the bill cannot be pinned down", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1]; // jbmYYYYMMDD
    const cases: [string, string][] = [
      [`alice-${day}-m099`, "编号里的成员没有这次活动的应付款"],
      [`alice-${day}-${s.bob.id.toLowerCase()}`, `备注里的名字和编号 ${s.bob.id.toLowerCase()} 不是同一个人`],
    ];
    for (const [i, [note]] of cases.entries()) expect(await deliver({ note, txnId: `R${i}` })).toBe("review");
    const { open } = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(open.map((i: { reason: string }) => i.reason).sort()).toEqual(cases.map((c) => c[1]).sort());
  });

  it("ignores everything else without storing it", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1];
    const ignored = [
      "Milktea9/27", // no code
      "", // no note
      `${day}-${s.alice.id.toLowerCase()}`, // code without a name
      `carol-${day}-${s.alice.id.toLowerCase()}`, // nobody in the group is called carol
      `alice-jbm20991231-${s.alice.id.toLowerCase()}`, // no such event
    ];
    for (const [i, note] of ignored.entries()) expect(await deliver({ note, txnId: `I${i}` })).toBe("ignored");
    expect(await deliver({ note: s.aliceCode, txnId: "W1", sentTo: "someone_else" })).toBe("wrong_recipient");
    // Right username, but Venmo addressed the receipt to someone else's email.
    expect(await deliver({ note: s.aliceCode, txnId: "W2", to: "carol@example.com" })).toBe("wrong_recipient");
    expect(await deliver({ note: s.aliceCode, txnId: "W3", to: "Owner@Example.com, carol@example.com" })).toBe(
      "wrong_recipient",
    );
    const html = (h: string) => h.replace("<h3>Transaction ID</h3>", "<h3>Reference</h3>");
    expect(await deliver({ note: s.aliceCode, txnId: "W4" }, { html })).toBe("parse_failed");
    expect(await inboundCount()).toBe(0);
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid" });
  });

  it("still recognises a member by the name on the bill after a rename", async () => {
    const s = await finalized();
    expect((await new Client().call(`${s.alice.base}/rename`, { username: "Alicia" })).status).toBe(200);
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "N1" })).toBe("paid");
  });

  const numberOf = (id: number) =>
    env.DB.prepare("SELECT number FROM events WHERE id = ?").bind(id).first<string>("number");

  /** The Owner moves the event to another day, as the requirements allow at any point before archive. */
  const moveTo = async (s: Awaited<ReturnType<typeof billingScenario>>, days: number) => {
    const d = (await s.admin.call(s.eb)).data;
    const res = await s.admin.call(`${s.eb}/edit`, {
      date: futureDate(days),
      startTime: d.startTime,
      endTime: d.endTime,
      location: d.location,
    });
    expect(res.status).toBe(200);
    return d.code as string;
  };

  it("still matches after the event's date is edited after Finalize", async () => {
    const s = await finalized();
    await moveTo(s, 8);
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "E1" })).toBe("paid");
  });

  it("still matches after the event's date is edited before Finalize", async () => {
    const s = await billingScenario();
    const number = await numberOf(s.e.id);
    const code = await moveTo(s, 8);
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const { payments } = (await s.admin.call(`${s.eb}/settlement`)).data;
    const alice = payments.find((p: { memberName: string }) => p.memberName === "Alice").paymentCode as string;
    // The bill carries the number the event was created with, not its new date.
    expect(alice).toBe(`alice-${number}-m002`);
    expect(await numberOf(s.e.id)).toBe(number);
    expect((await s.admin.call(s.eb)).data.code).toBe(code);
    expect(await deliver({ amount: "56.00", note: alice, txnId: "E2" })).toBe("paid");
  });

  it("matches a bill made before event numbers existed by the code printed on it", async () => {
    const s = await finalized();
    // A date edit before this change left the bill with another date than the event's number.
    await env.DB.prepare("UPDATE events SET number = 'jbm20991231' WHERE id = ?").bind(s.e.id).run();
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "E4" })).toBe("paid");
  });

  it("never gives a new event a number still printed on an older bill", async () => {
    const s = await finalized();
    const day = futureDate(20);
    const printed = `jbm${day.replace(/-/g, "")}`;
    // A bill made before event numbers existed, after its event was moved to that day.
    await env.DB.prepare("UPDATE payments SET payment_code = ? WHERE event_id = ? AND member_id = 'M002'")
      .bind(`alice-${printed}-m002`, s.e.id)
      .run();
    const next = await createTestEvent(s, { date: day });
    expect(await numberOf(next.id)).toBe(`${printed}b`);
  });

  it("never gives a moved event's number to a new event on its old date", async () => {
    const s = await finalized();
    const oldCode = await moveTo(s, 8);
    const next = await createTestEvent(s, { date: futureDate(7) });
    expect(next.code).not.toBe(oldCode);
    expect(next.code.slice(0, 4)).toBe(oldCode.slice(0, 4));
    expect(await numberOf(next.id)).not.toBe(await numberOf(s.e.id));
    // Paying the moved event's bill still lands there, not on the new event.
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "E3" })).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid" });
    // And its public link still opens it.
    expect((await new Client().call(`/api/public/events/${oldCode}`)).data.id).toBe(s.e.id);
  });
});

describe("Owner review", () => {
  it("links a 待确认 payment to a bill, ignores another, and archives when collected", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1];
    await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T11" });
    await deliver({ amount: "31.00", note: `bob-${day}-m099`, txnId: "T12" });
    await deliver({ amount: "9.00", note: `alice-${day}-m098`, txnId: "T13" });
    const { open, payments } = (await s.admin.call(`${s.base}/inbound`)).data;
    const bobs = open.find((i: { note: string }) => i.note.startsWith("bob"));
    const other = open.find((i: { note: string }) => i.note.startsWith("alice"));

    const linked = await s.admin.call(`${s.base}/inbound/${bobs.id}/link`, { paymentId: payments[0].id });
    expect(linked.data).toEqual({ ok: true, settled: true });
    expect(await s.by("Bob")).toMatchObject({ status: "paid", amountPaidCents: 3100 });
    expect((await s.admin.call(`${s.base}/inbound/${bobs.id}/link`, { paymentId: payments[0].id })).status).toBe(400);

    expect((await s.admin.call(`${s.base}/inbound/${other.id}/ignore`, {})).status).toBe(200);
    const after = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(after.open).toEqual([]);
    expect(after.done.map((i: { state: string }) => i.state)).toEqual(["linked"]);
    expect(after.ignored.map((i: { id: number }) => i.id)).toEqual([other.id]);
  });

  it("links a second payment to a paid bill, archived ones included, as an over-payment to refund", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1];
    await s.admin.call(`${s.base}/payments/${(await s.by("Alice")).id}/mark-paid`, {});
    const bob = await s.by("Bob");
    await s.admin.call(`${s.base}/payments/${bob.id}/mark-paid`, {}); // the last one pays cash: archived
    expect((await s.admin.call(`${s.eb}`)).data.status).toBe("settled");
    await deliver({ amount: "31.00", note: `bob-${day}-m099`, txnId: "D1" }); // and by Venmo, mistyped
    const d = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(d.payments.map((p: { memberName: string; status: string }) => [p.memberName, p.status])).toEqual([
      ["Alice", "paid"],
      ["Bob", "paid"],
    ]); // never the Owner's own bill
    const owner = (await s.admin.call(`${s.eb}/settlement`)).data.payments.find((p: { isPayee: boolean }) => p.isPayee);
    expect((await s.admin.call(`${s.base}/inbound/${d.open[0].id}/link`, { paymentId: owner.id })).status).toBe(400);

    expect((await s.admin.call(`${s.base}/inbound/${d.open[0].id}/link`, { paymentId: bob.id })).status).toBe(200);
    const after = await s.by("Bob");
    expect(after).toMatchObject({ status: "paid", amountPaidCents: 6200, refundCents: 3100 });
    expect((await s.admin.call(`${s.base}/inbound`)).data.refunds).toHaveLength(1);

    // Archived: the cash receipt can't come off (the bill would be unpaid), the extra Venmo one can.
    const [cash, venmo] = after.receipts;
    expect((await s.admin.call(`${s.base}/receipts/${cash.id}/remove`, {})).status).toBe(400);
    expect((await s.admin.call(`${s.base}/receipts/${venmo.id}/remove`, {})).status).toBe(200);
    expect(await s.by("Bob")).toMatchObject({ status: "paid", amountPaidCents: 3100 });
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toHaveLength(1);
    expect((await s.admin.call(`${s.eb}`)).data.status).toBe("settled");
  });

  it("tops up a partly paid bill from a linked payment, and undoing it puts the payment back", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1];
    await deliver({ amount: "20.00", note: s.aliceCode, txnId: "L1" });
    await deliver({ amount: "36.00", note: `alice-${day}-m099`, txnId: "L2" });
    const { open, payments } = (await s.admin.call(`${s.base}/inbound`)).data;
    const alice = payments.find((p: { memberName: string }) => p.memberName === "Alice");
    expect(alice).toMatchObject({ status: "partial", amountPaidCents: 2000 });
    await s.admin.call(`${s.base}/inbound/${open[0].id}/link`, { paymentId: alice.id });
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 5600 });

    const linked = (await s.by("Alice")).receipts[1];
    await s.admin.call(`${s.base}/receipts/${linked.id}/remove`, {});
    expect(await s.by("Alice")).toMatchObject({ status: "partial", amountPaidCents: 2000 });
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toHaveLength(1);

    // Cash for the rest.
    await s.admin.call(`${s.base}/payments/${alice.id}/mark-paid`, {});
    expect(await s.by("Alice")).toMatchObject({ status: "paid", amountPaidCents: 5600 });
  });

  it("undoing an auto-matched Venmo payment puts it in 待确认 instead of losing it", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "U1", payer: "Alice W" })).toBe("paid");
    const receipt = (await s.by("Alice")).receipts[0];
    expect((await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {})).status).toBe(200);
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid", amountPaidCents: 0 });
    const { open } = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(open).toMatchObject([
      { amountCents: 5600, txnId: "U1", payerName: "Alice W", note: s.aliceCode, reason: "从账单撤销的 Venmo 付款" },
    ]);
    // The same email again is still a duplicate, and the payment can be linked back.
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "U1" })).toBe("duplicate");
    await s.admin.call(`${s.base}/inbound/${open[0].id}/link`, { paymentId: (await s.by("Alice")).id });
    expect(await s.by("Alice")).toMatchObject({ status: "paid" });
  });

  it("undoing a linked payment without a transaction ID returns that row to 待确认", async () => {
    const s = await finalized();
    const row = (await env.DB.prepare(
      `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, received_at, kind, reason)
       VALUES (NULL, 'Cash', 1000, ?, 'unmatched', 'x') RETURNING id`,
    )
      .bind(new Date().toISOString())
      .first<{ id: number }>())!;
    const alice = await s.by("Alice");
    await s.admin.call(`${s.base}/inbound/${row.id}/link`, { paymentId: alice.id });
    const receipt = (await s.by("Alice")).receipts[0];
    await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {});
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toMatchObject([{ id: row.id }]);
    expect((await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {})).status).toBe(400); // second click
  });

  it("undoing an older linked receipt finds its 待确认 row by transaction", async () => {
    const s = await finalized();
    await deliver({ amount: "10.00", note: `alice-${s.aliceCode.split("-")[1]}-m099`, txnId: "O1" });
    const { open } = (await s.admin.call(`${s.base}/inbound`)).data;
    const alice = await s.by("Alice");
    await s.admin.call(`${s.base}/inbound/${open[0].id}/link`, { paymentId: alice.id });
    // As saved before receipts kept their source (and before 0004, as 'manual').
    await env.DB.prepare("UPDATE payment_receipts SET inbound_id = NULL, method = 'manual' WHERE payment_id = ?")
      .bind(alice.id)
      .run();
    const receipt = (await s.by("Alice")).receipts[0];
    await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {});
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toMatchObject([{ id: open[0].id, txnId: "O1" }]);
  });

  it("undoing reopens a trashed row but never one that counts on another bill", async () => {
    const s = await finalized();
    const day = s.aliceCode.split("-")[1];
    await deliver({ amount: "10.00", note: `alice-${day}-m098`, txnId: "T1" });
    await deliver({ amount: "11.00", note: `alice-${day}-m097`, txnId: "T2" });
    const { open, payments } = (await s.admin.call(`${s.base}/inbound`)).data;
    const [alice, bob] = ["Alice", "Bob"].map((n) => payments.find((p: { memberName: string }) => p.memberName === n));
    for (const i of open) await s.admin.call(`${s.base}/inbound/${i.id}/link`, { paymentId: alice.id });
    const [t1, t2] = ["T1", "T2"].map((t) => open.find((i: { txnId: string }) => i.txnId === t).id);
    // Neither can happen through the app, but a receipt must never take a row that counts elsewhere.
    await env.DB.prepare(
      "UPDATE inbound_payments SET state = 'deleted', deleted_from = 'open', deleted_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), t1)
      .run();
    await env.DB.batch([
      env.DB.prepare("UPDATE inbound_payments SET linked_payment_id = ? WHERE id = ?").bind(bob.id, t2),
      env.DB.prepare(
        "INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at, inbound_id) VALUES (?, 1100, 'venmo', ?, ?)",
      ).bind(bob.id, new Date().toISOString(), t2),
    ]);
    for (const r of (await s.by("Alice")).receipts) await s.admin.call(`${s.base}/receipts/${r.id}/remove`, {});
    // Undone again after relinking, the reason doesn't pile up.
    await s.admin.call(`${s.base}/inbound/${t1}/link`, { paymentId: alice.id });
    await s.admin.call(`${s.base}/receipts/${(await s.by("Alice")).receipts[0].id}/remove`, {});
    const d = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(d.open).toMatchObject([
      { id: t1, deletedAt: null, reason: "从账单撤销的 Venmo 付款（原先：编号里的成员没有这次活动的应付款）" },
    ]);
    expect(d.done).toMatchObject([{ id: t2, state: "linked" }]);
    expect(d.deleted).toEqual([]);
  });

  it("undoing a linked payment whose 待确认 row is gone still puts it back in 待确认", async () => {
    const s = await finalized();
    await deliver({ amount: "10.00", note: `alice-${s.aliceCode.split("-")[1]}-m099`, txnId: "G1", payer: "Carol" });
    const { open } = (await s.admin.call(`${s.base}/inbound`)).data;
    await s.admin.call(`${s.base}/inbound/${open[0].id}/link`, { paymentId: (await s.by("Alice")).id });
    await env.DB.prepare("DELETE FROM inbound_payments WHERE id = ?").bind(open[0].id).run();
    const receipt = (await s.by("Alice")).receipts[0];
    await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {});
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toMatchObject([
      { amountCents: 1000, txnId: "G1", payerName: "Carol", reason: "从账单撤销的 Venmo 付款" },
    ]);
  });
});

describe("DNS trouble", () => {
  it("never marks an unverified receipt paid, and only keeps ours for review", async () => {
    const s = await finalized();
    const down = async () => {
      throw new KeyLookupError("DNS lookup failed");
    };
    const send = async (f: ReceiptFields) => handleEmail(env, (await venmoEmail(f)).raw, { resolveKey: down });
    expect(await send({ amount: "56.00", note: s.aliceCode, txnId: "D1" })).toBe("review");
    expect(await send({ amount: "7.00", note: "Milktea", txnId: "D2" })).toBe("ignored");
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid" });
    expect((await s.admin.call(`${s.base}/inbound`)).data.open[0].reason).toMatch(/无法校验 Venmo 签名/);
  });
});

describe("收款设置", () => {
  it("needs the admin password and a valid Venmo notification email", async () => {
    const s = await billingScenario();
    const save = (body: Record<string, unknown>) =>
      s.admin.call(`${s.base}/settings/payment`, { password: "initial-password", ...body });
    expect(
      (
        await s.admin.call(`${s.base}/settings/payment`, {
          password: "wrong",
          venmoUsername: "KeLi8916",
          venmoEmail: "me@example.com",
        })
      ).status,
    ).toBe(401);
    expect((await save({ venmoUsername: "KeLi8916" })).status).toBe(400);
    expect((await save({ venmoUsername: "KeLi8916", venmoEmail: "not-an-email" })).status).toBe(400);
    expect(
      (await save({ venmoUsername: "KeLi8916", venmoEmail: " Me@Example.com ", zelleAccount: "z@example.com" })).status,
    ).toBe(200);
    expect((await s.admin.call(`${s.base}/settings`)).data).toMatchObject({
      venmoUsername: "KeLi8916",
      venmoEmail: "me@example.com",
      zelleAccount: "z@example.com",
    });
    // The ordinary settings form can no longer change where money goes.
    await s.admin.call(`${s.base}/settings`, { venmoUsername: "evil", zelleAccount: "evil" });
    expect((await s.admin.call(`${s.base}/settings`)).data).toMatchObject({
      venmoUsername: "KeLi8916",
      zelleAccount: "z@example.com",
    });
  });
});
