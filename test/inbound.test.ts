import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { KeyLookupError, verifyDkim } from "../src/worker/email/dkim";
import { htmlLines, parseEmail } from "../src/worker/email/parse";
import { handleEmail } from "../src/worker/inbound";
import { billingScenario } from "./helpers";
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
    const html = receiptHtml({ payer: "A", amount: "7.00", note: "Tom &amp; Jerry&#39;s", txnId: "X1", sentTo: "me", from: "" });
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
    ];
    for (const opts of cases) expect((await verifyDkim((await venmoEmail({}, opts)).raw, "venmo.com", resolveKey)).ok).toBe(false);
  });

  it("drops forged and unrelated mail before touching the database", async () => {
    expect(await deliver({}, { sign: false })).toBe("bad_signature");
    expect(await deliver({ from: "Venmo <venmo@evil.example>" })).toBe("not_venmo");
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM inbound_payments").first<{ n: number }>())!;
    expect(n).toBe(0);
  });
});

describe("matching", () => {
  it("marks the exact amount paid, ignores the same transaction twice, and archives when collected", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "56.00", note: `badminton ${s.aliceCode}`, txnId: "T1" })).toBe("paid");
    expect(await s.by("Alice")).toMatchObject({ status: "paid", method: "venmo_auto", amountPaidCents: 5600 });
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T1" })).toBe("duplicate");

    // Case and stray spaces in the code are tolerated; the name part is ignored.
    const loose = s.bobCode.replace(/^[^-]+/, "Robert").replace("-m", " - M").toUpperCase();
    expect(await deliver({ amount: "31.00", note: loose, txnId: "T2" })).toBe("paid");
    expect((await s.admin.call(s.eb)).data.status).toBe("settled");
  });

  it("records a wrong amount as an anomaly on the payment", async () => {
    const s = await finalized();
    expect(await deliver({ amount: "50.00", note: s.aliceCode, txnId: "T3" })).toBe("anomaly");
    expect(await s.by("Alice")).toMatchObject({ status: "anomaly", amountPaidCents: 5000 });
  });

  it("lists a second payment for a paid bill, unknown codes and plain payments for the Owner", async () => {
    const s = await finalized();
    await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T4" });
    expect(await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T5" })).toBe("anomaly");
    expect(await deliver({ amount: "31.00", note: "x-jbm20991231-m999", txnId: "T6" })).toBe("unmatched");
    expect(await deliver({ amount: "12.00", note: "Milktea9/27", txnId: "T7" })).toBe("other");
    expect(await deliver({ amount: "12.00", note: "Milktea", txnId: "T8", sentTo: "someone_else" })).toBe("wrong_recipient");

    const inbound = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(inbound.open.map((i: { kind: string }) => i.kind).sort()).toEqual(["anomaly", "other", "unmatched"]);
    expect(inbound.open.find((i: { kind: string }) => i.kind === "anomaly").linked.memberName).toBe("Alice");
    expect(inbound.payments.map((p: { memberName: string }) => p.memberName)).toEqual(["Bob"]);
  });

  it("keeps a signed receipt it cannot read, with its text", async () => {
    await billingScenario();
    const html = (h: string) => h.replace("<h3>Transaction ID</h3>", "<h3>Reference</h3>");
    expect(await deliver({ txnId: "T10" }, { html })).toBe("parse_failed");
    const row = await env.DB.prepare("SELECT kind, raw_text FROM inbound_payments").first<{ kind: string; raw_text: string }>();
    expect(row!.raw_text).toContain("Reference\nT10");
  });
});

describe("Owner review", () => {
  it("links a plain payment to a bill, ignores another, and archives when collected", async () => {
    const s = await finalized();
    await deliver({ amount: "56.00", note: s.aliceCode, txnId: "T11" });
    await deliver({ amount: "31.00", note: "for wednesday", txnId: "T12" });
    await deliver({ amount: "9.00", note: "lunch", txnId: "T13" });
    const { open, payments } = (await s.admin.call(`${s.base}/inbound`)).data;
    const wed = open.find((i: { note: string }) => i.note === "for wednesday");
    const lunch = open.find((i: { note: string }) => i.note === "lunch");

    const linked = await s.admin.call(`${s.base}/inbound/${wed.id}/link`, { paymentId: payments[0].id });
    expect(linked.data).toEqual({ ok: true, settled: true });
    expect(await s.by("Bob")).toMatchObject({ status: "paid", method: "manual", amountPaidCents: 3100 });
    expect((await s.admin.call(`${s.base}/inbound/${wed.id}/link`, { paymentId: payments[0].id })).status).toBe(400);

    expect((await s.admin.call(`${s.base}/inbound/${lunch.id}/ignore`, {})).status).toBe(200);
    const after = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(after.open).toEqual([]);
    expect(after.done.map((i: { state: string }) => i.state).sort()).toEqual(["ignored", "linked"]);
  });
});

describe("DNS trouble", () => {
  it("parks a receipt for review when Venmo's key cannot be fetched", async () => {
    const s = await finalized();
    const down = async () => {
      throw new KeyLookupError("DNS lookup failed");
    };
    const { raw } = await venmoEmail({ amount: "56.00", note: s.aliceCode, txnId: "T20" });
    expect(await handleEmail(env, raw, { resolveKey: down })).toBe("parse_failed");
    expect(await s.by("Alice")).toMatchObject({ status: "unpaid" });
    const row = await env.DB.prepare("SELECT raw_text FROM inbound_payments").first<{ raw_text: string }>();
    expect(row!.raw_text).toMatch(/^\[无法校验 Venmo 签名/);
  });
});
