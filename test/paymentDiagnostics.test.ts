import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { PaymentDiagnosticStep } from "../src/shared/paymentDiagnostics";
import { KeyLookupError } from "../src/worker/email/dkim";
import { handleEmail } from "../src/worker/inbound";
import { diagnoseOversizedEmail, paymentDiagnostics, purgePaymentDiagnostics } from "../src/worker/paymentDiagnostics";
import worker from "../src/worker/index";
import { appoint, Client, billingScenario, request, setUpAdmin } from "./helpers";
import { testKey, venmoEmail, type ReceiptFields } from "./venmoMail";

let resolveKey: Awaited<ReturnType<typeof testKey>>["resolveKey"];
beforeAll(async () => {
  resolveKey = (await testKey()).resolveKey;
});
const enable = () =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES ('payment_diagnostics_enabled', '1')").run();
const deliver = async (fields: ReceiptFields, opts?: Parameters<typeof venmoEmail>[1]) =>
  handleEmail(env, (await venmoEmail(fields, opts)).raw, { resolveKey });
const rows = async () =>
  (
    await env.DB.prepare("SELECT * FROM payment_diagnostics ORDER BY id").all<{
      outcome: string;
      steps_json: string;
      txn_id: string;
      note: string;
    }>()
  ).results;
const steps = async () => JSON.parse((await rows()).at(-1)!.steps_json) as PaymentDiagnosticStep[];

async function billed() {
  const s = await billingScenario();
  expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).status).toBe(200);
  const payment = (await s.admin.call(`${s.eb}/settlement`)).data.payments.find(
    (p: { memberName: string }) => p.memberName === "Alice",
  );
  return { ...s, code: payment.paymentCode as string, pid: payment.id as number };
}

describe("opt-in Venmo payment diagnostics", () => {
  it("is off by default, can be toggled by the Owner, and does not backfill or log while off", async () => {
    const s = await setUpAdmin();
    const endpoint = `${s.base}/payment-diagnostics`;
    expect((await s.admin.call(endpoint)).data).toMatchObject({ enabled: false, records: [] });
    await deliver({ note: "Milktea", txnId: "OFF1" });
    expect(await rows()).toHaveLength(0);
    expect((await s.admin.call(endpoint, { enabled: true })).status).toBe(200);
    await deliver({ note: "Milktea", txnId: "ON1" });
    expect(await rows()).toHaveLength(1);
    expect((await s.admin.call(endpoint, { enabled: false })).status).toBe(200);
    await deliver({ note: "Milktea", txnId: "OFF2" });
    expect(await rows()).toHaveLength(1);
    expect((await s.admin.call(endpoint, { enabled: "true" })).status).toBe(400);
  });

  it("refuses unauthenticated callers and organizers, including writes", async () => {
    const s = await billingScenario();
    const organizer = await appoint(s.alice.id, "alice");
    for (const body of [undefined, { enabled: true }]) {
      expect((await request("/api/admin/google/payment-diagnostics", organizer, body)).status).toBe(403);
      expect((await request("/api/admin/google/payment-diagnostics", "", body)).status).toBe(401);
      expect((await new Client().call(`${s.base}/payment-diagnostics`, body)).status).toBe(401);
    }
    expect((await s.admin.call(`${s.base}/payment-diagnostics?before=oops`)).status).toBe(400);
  });

  it("records successful payments, stages in execution order, actual and expected names, and duplicates separately", async () => {
    const s = await billed();
    await enable();
    expect(await deliver({ note: s.code.toUpperCase(), txnId: "PAID1" })).toBe("paid");
    const trace = await steps();
    expect(trace.map((s) => s.stage)).toEqual([
      "size",
      "mime",
      "sender",
      "subject",
      "dkim",
      "receipt",
      "receiving_account",
      "recipient_count",
      "recipient_username",
      "recipient_email",
      "note_code",
      "group_name",
      "bill_lookup",
      "event",
      "duplicate",
      "account_active",
      "event_payee",
      "bill",
      "bill_name",
      "verified",
      "ledger",
      "audit",
      "balance",
      "archive",
    ]);
    expect(trace.every((s) => s.status === "passed")).toBe(true);
    expect(trace.find((s) => s.stage === "bill_name")).toMatchObject({ actual: "alice", expected: "alice" });
    expect(await deliver({ note: s.code, txnId: "PAID1" })).toBe("duplicate");
    expect((await rows()).map((r) => r.outcome)).toEqual(["paid", "duplicate"]);
    expect((await steps()).at(-1)).toMatchObject({ stage: "duplicate", status: "warning" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_receipts WHERE venmo_txn_id = 'PAID1'").first(),
    ).toEqual({ n: 1 });
    expect(JSON.stringify(await paymentDiagnostics(env))).not.toContain("For any issues");
  });

  it.each([
    { name: "missing code", note: "Milktea", stage: "note_code", outcome: "ignored" },
    { name: "unknown name", note: "stranger-jbm20261006-m007", stage: "group_name", outcome: "ignored" },
    { name: "unknown event", note: "alice-jbm19000101-m007", stage: "event", outcome: "ignored" },
  ])("explains $name", async ({ note, stage, outcome }) => {
    await billed();
    await enable();
    expect(await deliver({ note })).toBe(outcome);
    expect(await steps()).toContainEqual(expect.objectContaining({ stage, status: "failed" }));
  });

  it.each([
    { name: "username", fields: { sentTo: "other-user" }, stage: "recipient_username" },
    { name: "email", fields: { to: "wrong@example.com" }, stage: "recipient_email" },
  ])("distinguishes wrong recipient $name", async ({ fields, stage }) => {
    const s = await billed();
    await enable();
    expect(await deliver({ note: s.code, ...fields })).toBe("wrong_recipient");
    expect(await steps()).toContainEqual(expect.objectContaining({ stage, status: "failed" }));
    expect(await steps()).not.toContainEqual(expect.objectContaining({ stage: "ledger" }));
  });

  it("shows name mismatch against the bill, even if the name belongs to another group member", async () => {
    const s = await billed();
    await enable();
    expect(await deliver({ note: s.code.replace("alice-", "bob-") })).toBe("review");
    expect(await steps()).toContainEqual(
      expect.objectContaining({ stage: "bill_name", status: "failed", actual: "bob", expected: "alice" }),
    );
  });

  it("records non-receipt Venmo mail, but excludes unrelated senders", async () => {
    await enable();
    expect(await deliver({}, { subject: "Venmo newsletter" })).toBe("not_receipt");
    expect(await deliver({ from: "other@example.com" })).toBe("not_venmo");
    expect((await rows()).map((r) => r.outcome)).toEqual(["not_receipt"]);
  });

  it("records invalid signatures without admitting money to the ledger", async () => {
    const s = await billed();
    await enable();
    expect(await deliver({ note: s.code, txnId: "FORGED" }, { sign: false })).toBe("bad_signature");
    expect((await steps()).at(-1)).toMatchObject({ stage: "dkim", status: "failed" });
    expect(await env.DB.prepare("SELECT 1 FROM payment_receipts WHERE venmo_txn_id = 'FORGED'").first()).toBeNull();
  });

  it("explains signature lookup outages and keeps unverified receipts out of the ledger", async () => {
    const s = await billed();
    await enable();
    const raw = (await venmoEmail({ note: s.code, txnId: "DNS1" })).raw;
    expect(
      await handleEmail(env, raw, {
        resolveKey: async () => {
          throw new KeyLookupError("test DNS outage");
        },
      }),
    ).toBe("review");
    expect(await steps()).toContainEqual(expect.objectContaining({ stage: "dkim", status: "warning" }));
    expect(await steps()).toContainEqual(expect.objectContaining({ stage: "verified", status: "failed" }));
    expect(await env.DB.prepare("SELECT 1 FROM payment_receipts WHERE venmo_txn_id = 'DNS1'").first()).toBeNull();
  });

  it("identifies the specific receipt parser failure", async () => {
    await enable();
    expect(await deliver({}, { html: (h) => h.replace("<h3>Transaction ID</h3>", "") })).toBe("parse_failed");
    expect(await steps()).toContainEqual(
      expect.objectContaining({ stage: "receipt", status: "failed", detail: expect.stringContaining("交易 ID") }),
    );
  });

  it("records partial and excess payments without changing accounting behavior", async () => {
    const s = await billed();
    await enable();
    expect(await deliver({ note: s.code, txnId: "PART1", amount: "20.00" })).toBe("partial");
    expect(await deliver({ note: s.code, txnId: "PART2", amount: "40.00" })).toBe("overpaid");
    expect((await rows()).map((r) => r.outcome)).toEqual(["partial", "overpaid"]);
    expect(await env.DB.prepare("SELECT amount_paid_cents FROM payments WHERE id = ?").bind(s.pid).first()).toEqual({
      amount_paid_cents: 6000,
    });
  });

  it("records the layer where processing throws, and diagnostics storage failures do not prevent payments", async () => {
    const s = await billed();
    await enable();
    const proxy = (fail: (sql: string) => boolean) => ({
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "prepare")
            return (sql: string) => {
              if (fail(sql)) throw new Error("synthetic failure");
              return target.prepare(sql);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const raw = (await venmoEmail({ note: s.code, txnId: "ERROR1" })).raw;
    await expect(
      handleEmail(
        proxy((sql) => sql.includes("INSERT OR IGNORE INTO payment_receipts")),
        raw,
        { resolveKey },
      ),
    ).rejects.toThrow("synthetic failure");
    expect((await rows()).at(-1)!.outcome).toBe("processing_error");
    expect((await steps()).at(-1)).toMatchObject({ stage: "ledger", status: "failed" });
    expect(
      await handleEmail(
        proxy((sql) => sql.includes("payment_diagnostics")),
        (await venmoEmail({ note: s.code, txnId: "STORAGE1" })).raw,
        { resolveKey },
      ),
    ).toBe("paid");
  });

  it("records oversized Venmo mail without reading its body", async () => {
    await enable();
    await diagnoseOversizedEmail(env, "Venmo <venmo@venmo.com>");
    expect((await rows()).at(-1)!.outcome).toBe("too_large");
    expect((await steps()).at(-1)).toMatchObject({ stage: "size", status: "failed" });
  });

  it("purges records older than 14 days even while off, and paginates records without exposing expired data", async () => {
    const at = new Date();
    await env.DB.batch(
      Array.from({ length: 52 }, (_, i) =>
        env.DB.prepare("INSERT INTO payment_diagnostics (received_at, outcome) VALUES (?, 'ignored')").bind(
          new Date(at.getTime() - (i === 0 ? 15 : 1) * 86400_000).toISOString(),
        ),
      ),
    );
    const first = await paymentDiagnostics(env);
    expect(first.enabled).toBe(false);
    expect(first.records).toHaveLength(50);
    expect(first.nextBefore).not.toBeNull();
    const second = await paymentDiagnostics(env, first.nextBefore!);
    expect(second.records).toHaveLength(1);
    expect(second.nextBefore).toBeNull();
    expect((await rows()).length).toBe(51);
    await purgePaymentDiagnostics(env, new Date(at.getTime() + 14 * 86400_000));
    expect(await rows()).toHaveLength(0);
  });

  it("runs expiry before other cron work, even if a later job fails", async () => {
    await env.DB.prepare(
      "INSERT INTO payment_diagnostics (received_at, outcome) VALUES ('2000-01-01T00:00:00.000Z', 'ignored')",
    ).run();
    const broken = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          if (key === "prepare")
            return (sql: string) => {
              if (sql.startsWith("UPDATE events SET status = 'closed'")) throw new Error("cron failure");
              return target.prepare(sql);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    await worker.scheduled({} as ScheduledController, broken, {} as ExecutionContext);
    expect(await rows()).toHaveLength(0);
  });
});
