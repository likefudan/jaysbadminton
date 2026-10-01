import { formatDateZh } from "../shared/time";
import type { InboundKind, InboundRow, OpenPayment } from "../shared/types";
import { checkCollected } from "./billing";
import { getSettings, now } from "./db";
import { type KeyResolver, verifyDkim } from "./email/dkim";
import { parseEmail, type VenmoReceipt } from "./email/parse";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { codeName, noteName, parsePaymentCode } from "./paymentCode";

export const MAX_EMAIL_BYTES = 512 * 1024;
const VENMO = "venmo@venmo.com";

/** What happened to one email; returned for tests and logged by the email handler. */
export type EmailOutcome =
  | "too_large"
  | "not_venmo"
  | "not_receipt"
  | "bad_signature"
  | "parse_failed"
  | "wrong_recipient"
  | "duplicate"
  | "ignored" // no code of ours, or a name / event nobody in the group has
  | "paid"
  | "anomaly"
  | "review";

export interface EmailOptions {
  resolveKey?: KeyResolver;
}

/**
 * The Owner forwards every Venmo receipt, most of them unrelated to badminton, so only notes
 * carrying our code with a group member's name and an existing event are acted on:
 * - code, person and amount all match an unpaid bill → paid;
 * - wrong amount, or the bill is already paid → the bill is flagged 金额异常;
 * - the event exists but the bill cannot be pinned down → 待确认 for the Owner;
 * - everything else (no code, unknown name or event, unreadable email) is ignored and not stored.
 */
export async function handleEmail(env: Env, raw: Uint8Array, opts: EmailOptions = {}): Promise<EmailOutcome> {
  if (raw.byteLength > MAX_EMAIL_BYTES) return "too_large";
  const mail = await parseEmail(raw);
  if (mail.fromAddress !== VENMO) return "not_venmo";
  if (!/ paid \$[\d,]+\.\d{2} to your Venmo account/.test(mail.subject.replace(/\s+/g, " "))) return "not_receipt";
  const dkim = await verifyDkim(raw, "venmo.com", opts.resolveKey);
  if (!dkim.ok && !dkim.retryable) {
    console.warn("venmo email rejected:", dkim.reason);
    return "bad_signature";
  }
  // DNS was down so the signature is unchecked: never act on it, at most ask the Owner.
  const unverified = !dkim.ok;

  const r = mail.receipt;
  if (!r) return "parse_failed";

  // Both must match: the username printed in the body and the email Venmo addressed it to.
  const { venmo_username: owner = "", venmo_email: ownerEmail = "" } = await getSettings(env.DB, ["venmo_username", "venmo_email"]);
  if (!owner || r.sentTo.toLowerCase() !== owner.toLowerCase()) return "wrong_recipient";
  if (!ownerEmail || mail.toAddresses.length !== 1 || mail.toAddresses[0] !== ownerEmail) return "wrong_recipient";

  const code = parsePaymentCode(r.note);
  if (!code?.name || !(await isGroupName(env, code.name))) return "ignored";
  const e = await env.DB.prepare("SELECT * FROM events WHERE date = ? AND code = ?").bind(code.date, code.eventCode).first<EventRow>();
  if (!e) return "ignored";

  const seen = await env.DB.prepare(
    "SELECT 1 FROM inbound_payments WHERE venmo_txn_id = ?1 UNION ALL SELECT 1 FROM payments WHERE venmo_txn_id = ?1",
  )
    .bind(r.txnId)
    .first();
  if (seen) return "duplicate";

  const p = await env.DB.prepare(
    `SELECT p.id, p.status, p.amount_due_cents, p.payment_code, m.username FROM payments p
     JOIN members m ON m.id = p.member_id WHERE p.event_id = ? AND p.member_id = ?`,
  )
    .bind(e.id, code.memberId)
    .first<{ id: number; status: string; amount_due_cents: number; payment_code: string; username: string }>();
  const review = (reason: string) => record(env, r, mail.messageId, { kind: "unmatched", reason });

  if (!p) {
    if (e.status === "open" || e.status === "closed") return review("这次活动还没结算");
    if (e.status === "cancelled") return review("这次活动已取消");
    return review("编号里的成员没有这次活动的应付款");
  }
  if (code.name !== codeName(p.payment_code) && code.name !== noteName(p.username)) {
    return review(`备注里的名字和编号 ${code.memberId.toLowerCase()} 不是同一个人`);
  }
  if (e.status === "settled") return review("这次活动已收齐归档，可能是重复付款");
  if (unverified) return review("暂时无法校验 Venmo 签名，请核对后手动关联");

  if (p.status === "unpaid") {
    const status = r.amountCents === p.amount_due_cents ? "paid" : "anomaly";
    const res = await env.DB.prepare(
      `UPDATE payments SET status = ?, method = 'venmo_auto', amount_paid_cents = ?, paid_at = ?, venmo_txn_id = ?, email_id = ?
       WHERE id = ? AND status = 'unpaid'`,
    )
      .bind(status, r.amountCents, now(), r.txnId, mail.messageId, p.id)
      .run();
    if (res.meta.changes > 0) {
      if (status === "paid") await checkCollected(env, e.id);
      // Card 6: notify the Owner about an anomaly.
      return status;
    }
  }
  // Paid already (or flagged): a second payment. Add it to what was received and flag the bill;
  // the transaction is kept as a handled row so the same email is never counted twice.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE payments SET status = 'anomaly', amount_paid_cents = COALESCE(amount_paid_cents, 0) + ? WHERE id = ?`,
    ).bind(r.amountCents, p.id),
    insertStmt(env, r, mail.messageId, { kind: "anomaly", state: "linked", paymentId: p.id, reason: "重复付款" }),
  ]);
  return "anomaly";
}

/** True when the note's name is someone's in the group, now or as printed on an earlier bill. */
async function isGroupName(env: Env, name: string): Promise<boolean> {
  const { results: members } = await env.DB.prepare("SELECT username FROM members").all<{ username: string }>();
  if (members.some((m) => noteName(m.username) === name)) return true;
  const { results: codes } = await env.DB.prepare("SELECT DISTINCT payment_code FROM payments").all<{ payment_code: string }>();
  return codes.some((c) => codeName(c.payment_code) === name);
}

interface InboundInsert {
  kind: InboundKind;
  reason: string;
  state?: "open" | "linked";
  paymentId?: number;
}

function insertStmt(env: Env, r: VenmoReceipt, emailId: string, row: InboundInsert): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO inbound_payments
       (venmo_txn_id, email_id, payer_name, amount_cents, note, received_at, kind, state, linked_payment_id, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(r.txnId, emailId, r.payer, r.amountCents, r.note, now(), row.kind, row.state ?? "open", row.paymentId ?? null, row.reason);
}

async function record(env: Env, r: VenmoReceipt, emailId: string, row: InboundInsert): Promise<EmailOutcome> {
  const res = await insertStmt(env, r, emailId, row).run();
  // Card 6: notify the Owner about a new 待确认 row.
  return res.meta.changes > 0 ? "review" : "duplicate";
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
    reason: i.reason,
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
