import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { KeyLookupError, verifyDkim } from "../src/worker/email/dkim";
import { htmlLines, parseEmail } from "../src/worker/email/parse";
import { handleEmail } from "../src/worker/inbound";
import { Client, billingScenario } from "./helpers";
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
  return { ...s, aliceCode: by("Alice").paymentCode as string, bobCode: by("Bob").paymentCode as string, by: async (name: string) =>
    (await s.admin.call(`${s.eb}/settlement`)).data.payments.find((p: { memberName: string }) => p.memberName === name) };
}

describe("receipt parsing", () => {
  it("reads every field from the HTML layout, joining the split amount", async () => {
    const { raw } = await venmoEmail({ payer: "Yue sun", amount: "1,234.50", note: "Milktea9/27", txnId: "77B44894RT023271X" });
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
    const html = receiptHtml({ payer: "A", amount: "7.00", note: "Tom &amp; Jerry&#39;s", txnId: "X1", sentTo: "me", from: "", to: "" });
    expect(htmlLines(html)).toContain("Tom & Jerry's");
    const noTxn = html.replace("<h3>Transaction ID</h3>", "");
    expect(htmlLines(noTxn)).not.toContain("Transaction ID");
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
    for (const opts of cases) expect((await verifyDkim((await venmoEmail({}, opts)).raw, "venmo.com", resolveKey)).ok).toBe(false);
  });

  it("drops forged and unrelated mail", async () => {
    const s = await finalized();
    expect(await deliver({ note: s.aliceCode }, { sign: false })).toBe("bad_signature");
    expect(await deliver({ note: s.aliceCode, from: "Venmo <venmo@evil.example>" })).toBe("not_venmo");
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid" });
  });
});

const inboundCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM inbound_payments").first<{ n: number }>())!.n;

describe("matching", () => {
  it("marks the exact amount paid, ignores the same transaction twice, and archives when collected", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "56.00", note: `badminton ${s.aliceCode}`, txnId: "T1" })).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", method: "venmo_auto", amountPaidCents: 5600 });
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T1" })).toBe("duplicate");

    // Case and stray spaces are tolerated.
    const loose = s.bobCode.replace("-m", " - M").toUpperCase();
    expect(await deliver({ amount: "31.00", note: loose, txnId: "T2" })).toBe("paid");
    expect((await s.admin.call(s.eb)).data.status).toBe("settled");
  });

  it("flags a wrong amount, and a second payment for a paid bill, as 金额异常", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "50.00", note: s.aliceCode, txnId: "T3" })).toBe("anomaly");
    expect(await s.by("Alice")).toMatchObject({ status: "anomaly", amountPaidCents: 5000 });

    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "T4" })).toBe("paid");
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "T5" })).toBe("anomaly");
    expect(await s.by("Bob")).toMatchObject({ status: "anomaly", amountPaidCents: 6200 });
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "T5" })).toBe("duplicate");
    // Neither needs the 待确认 list; the board shows them.
    expect((await s.admin.call(`${s.base}/inbound`)).data.open).toEqual([]);
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
    expect(await deliver({ note: s.aliceCode, txnId: "W3", to: "Owner@Example.com, carol@example.com" })).toBe("wrong_recipient");
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
    expect(await s.by("Bob")).toMatchObject({ status: "paid", method: "manual", amountPaidCents: 3100 });
    expect((await s.admin.call(`${s.base}/inbound/${bobs.id}/link`, { paymentId: payments[0].id })).status).toBe(400);

    expect((await s.admin.call(`${s.base}/inbound/${other.id}/ignore`, {})).status).toBe(200);
    const after = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(after.open).toEqual([]);
    expect(after.done.map((i: { state: string }) => i.state).sort()).toEqual(["ignored", "linked"]);
  });

  it("sends payments for an archived event to 待确认", async () => {
    const s = await finalized();
    await deliver({ amount: "56.00", note: s.aliceCode, txnId: "A1" });
    await deliver({ amount: "31.00", note: s.bobCode, txnId: "A2" });
    expect(await deliver({ amount: "31.00", note: s.bobCode, txnId: "A3" })).toBe("review");
    expect((await s.admin.call(`${s.base}/inbound`)).data.open[0].reason).toBe("这次活动已收齐归档，可能是重复付款");
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

describe("Venmo settings", () => {
  it("requires the Venmo notification email together with the username", async () => {
    const s = await billingScenario();
    expect((await s.admin.call(`${s.base}/settings`, { venmoUsername: "KeLi8916" })).status).toBe(400);
    expect((await s.admin.call(`${s.base}/settings`, { venmoUsername: "KeLi8916", venmoEmail: "not-an-email" })).status).toBe(400);
    expect((await s.admin.call(`${s.base}/settings`, { venmoUsername: "KeLi8916", venmoEmail: " Me@Example.com " })).status).toBe(200);
    expect((await s.admin.call(`${s.base}/settings`)).data).toMatchObject({ venmoUsername: "KeLi8916", venmoEmail: "me@example.com" });
  });
});
