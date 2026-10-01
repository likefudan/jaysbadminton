import { formatDateZh } from "../shared/time";
import type { InboundKind, InboundRow, OpenPayment } from "../shared/types";
import { checkCollected } from "./billing";
import { getSettings, now } from "./db";
import { type KeyResolver, verifyDkim } from "./email/dkim";
import { parseEmail, type VenmoReceipt } from "./email/parse";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { parsePaymentCode } from "./paymentCode";

export const MAX_EMAIL_BYTES = 512 * 1024;
const RAW_TEXT_LIMIT = 50 * 1024;
const VENMO = "venmo@venmo.com";

/** What happened to one email; returned for tests and logged by the email handler. */
export type EmailOutcome =
  | "too_large"
  | "not_venmo"
  | "not_receipt"
  | "bad_signature"
  | "wrong_recipient"
  | "duplicate"
  | "paid"
  | InboundKind;

export interface EmailOptions {
  resolveKey?: KeyResolver;
}

/**
 * Turns one forwarded email into at most one change: a payment marked paid or anomaly, or an
 * inbound row for the Owner to review. Non-Venmo mail, forged mail and receipts for another
 * Venmo account are dropped without a trace beyond the log line.
 */
export async function handleEmail(env: Env, raw: Uint8Array, opts: EmailOptions = {}): Promise<EmailOutcome> {
  if (raw.byteLength > MAX_EMAIL_BYTES) return "too_large";
  const mail = await parseEmail(raw);
  if (mail.fromAddress !== VENMO) return "not_venmo";
  if (!/ paid \$[\d,]+\.\d{2} to your Venmo account/.test(mail.subject.replace(/\s+/g, " "))) return "not_receipt";
  const dkim = await verifyDkim(raw, "venmo.com", opts.resolveKey);
  if (!dkim.ok && dkim.retryable) {
    // DNS was down: never drop a possibly real payment, but never auto-mark it either.
    const text = `[无法校验 Venmo 签名：${dkim.reason}]\n${mail.text}`;
    await insertInbound(env, { kind: "parse_failed", emailId: mail.messageId, rawText: text.slice(0, RAW_TEXT_LIMIT) });
    return "parse_failed";
  }
  if (!dkim.ok) {
    console.warn("venmo email rejected:", dkim.reason);
    return "bad_signature";
  }

  const r = mail.receipt;
  if (!r) {
    await insertInbound(env, { kind: "parse_failed", emailId: mail.messageId, rawText: mail.text.slice(0, RAW_TEXT_LIMIT) });
    return "parse_failed";
  }

  const { venmo_username: owner = "" } = await getSettings(env.DB, ["venmo_username"]);
  if (r.sentTo.toLowerCase() !== owner.toLowerCase()) return "wrong_recipient";

  const seen = await env.DB.prepare(
    "SELECT 1 FROM inbound_payments WHERE venmo_txn_id = ?1 UNION ALL SELECT 1 FROM payments WHERE venmo_txn_id = ?1",
  )
    .bind(r.txnId)
    .first();
  if (seen) return "duplicate";

  const code = parsePaymentCode(r.note);
  if (!code) return record(env, "other", r, mail.messageId);

  const e = await env.DB.prepare(
    code.date
      ? "SELECT * FROM events WHERE date = ? AND code = ? AND status = 'finalized'"
      : "SELECT * FROM events WHERE code = ? AND status = 'finalized' ORDER BY start_at DESC LIMIT 1",
  )
    .bind(...(code.date ? [code.date, code.eventCode] : [code.eventCode]))
    .first<EventRow>();
  const p = e
    ? await env.DB.prepare("SELECT id, status, amount_due_cents FROM payments WHERE event_id = ? AND member_id = ?")
        .bind(e.id, code.memberId)
        .first<{ id: number; status: string; amount_due_cents: number }>()
    : null;
  if (!e || !p) return record(env, "unmatched", r, mail.messageId);
  // Already paid (twice) or already flagged: keep the money visible and let the Owner sort it out.
  if (p.status !== "unpaid") return record(env, "anomaly", r, mail.messageId, p.id);

  const status = r.amountCents === p.amount_due_cents ? "paid" : "anomaly";
  const res = await env.DB.prepare(
    `UPDATE payments SET status = ?, method = 'venmo_auto', amount_paid_cents = ?, paid_at = ?, venmo_txn_id = ?, email_id = ?
     WHERE id = ? AND status = 'unpaid'`,
  )
    .bind(status, r.amountCents, now(), r.txnId, mail.messageId, p.id)
    .run();
  if (res.meta.changes === 0) return record(env, "anomaly", r, mail.messageId, p.id);
  if (status === "paid") {
    await checkCollected(env, e.id);
    return "paid";
  }
  // Card 6: notify the Owner about the amount mismatch.
  return "anomaly";
}

async function record(env: Env, kind: InboundKind, r: VenmoReceipt, emailId: string, paymentId?: number): Promise<EmailOutcome> {
  const inserted = await insertInbound(env, { kind, emailId, receipt: r, paymentId });
  // Card 6: notify the Owner for unmatched and anomaly rows ("other" stays quiet).
  return inserted ? kind : "duplicate";
}

async function insertInbound(
  env: Env,
  row: { kind: InboundKind; emailId: string; receipt?: VenmoReceipt; paymentId?: number; rawText?: string },
): Promise<boolean> {
  const r = row.receipt;
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO inbound_payments
       (venmo_txn_id, email_id, payer_name, amount_cents, note, received_at, kind, linked_payment_id, raw_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      r?.txnId ?? null,
      row.emailId,
      r?.payer ?? null,
      r?.amountCents ?? null,
      r?.note ?? null,
      now(),
      row.kind,
      row.paymentId ?? null,
      row.rawText ?? null,
    )
    .run();
  return res.meta.changes > 0;
}

const eventLabel = (date: string, code: string) => formatDateZh(date) + (code.length > 4 ? ` 第${code.charCodeAt(4) - 64}场` : "");

export async function inboundRows(env: Env, state: "open" | "done"): Promise<InboundRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT i.*, m.username, e.date, e.code FROM inbound_payments i
     LEFT JOIN payments p ON p.id = i.linked_payment_id
     LEFT JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     WHERE ${state === "open" ? "i.state = 'open'" : "i.state != 'open'"}
     ORDER BY i.received_at DESC LIMIT ${state === "open" ? 200 : 30}`,
  ).all<Record<string, any>>();
  return results.map((i) => ({
    id: i.id,
    kind: i.kind,
    state: i.state,
    payerName: i.payer_name,
    amountCents: i.amount_cents,
    note: i.note,
    receivedAt: i.received_at,
    txnId: i.venmo_txn_id,
    rawText: i.raw_text,
    linked: i.linked_payment_id
      ? { paymentId: i.linked_payment_id, memberName: i.username, eventLabel: eventLabel(i.date, i.code) }
      : null,
  }));
}

/** Payments an inbound row can be linked to: not yet paid, on events still collecting. */
export async function openPayments(env: Env): Promise<OpenPayment[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.amount_due_cents, p.status, p.payment_code, m.username, e.date, e.code
     FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id
     WHERE p.status != 'paid' AND e.status = 'finalized'
     ORDER BY e.start_at DESC, m.username`,
  ).all<Record<string, any>>();
  return results.map((p) => ({
    id: p.id,
    eventLabel: eventLabel(p.date, p.code),
    memberName: p.username,
    amountDueCents: p.amount_due_cents,
    status: p.status,
    paymentCode: p.payment_code,
  }));
}
