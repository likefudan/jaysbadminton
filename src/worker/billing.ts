import { settle, type SettleInput, type Settlement, type SettleRow } from "../shared/settle";
import type { PaymentRow, Receipt } from "../shared/types";
import { now, setSetting } from "./db";
import { notifyCollected, notifyFinalized } from "./notify";
import { paymentCode } from "./paymentCode";
import type { Env } from "./env";
import { type EventRow, roster } from "./events";

export async function settleRows(env: Env, eventId: number): Promise<SettleRow[]> {
  return (await roster(env, eventId)).map((r) => ({
    memberId: r.memberId,
    friendIndex: r.friendIndex,
    name: r.name,
    attended: r.attended,
  }));
}

export async function savedInput(env: Env, eventId: number): Promise<SettleInput | null> {
  const s = await env.DB.prepare(
    "SELECT court_total_cents, shuttle_count, shuttle_price_cents FROM settlements WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ court_total_cents: number; shuttle_count: number; shuttle_price_cents: number }>();
  return s ? { courtTotalCents: s.court_total_cents, shuttleCount: s.shuttle_count, shuttlePriceCents: s.shuttle_price_cents } : null;
}

/**
 * Writes the settlement and brings the payment rows in line with it. Unpaid and partly paid rows
 * follow the new amounts; paid rows are left alone. The Owner's own bill is paid with a manual
 * receipt. A member who left the roster loses a row that has received nothing.
 */
export async function applySettlement(env: Env, e: EventRow, input: SettleInput): Promise<Settlement> {
  const result = settle(await settleRows(env, e.id), input);
  const ts = now();
  const { results: existing } = await env.DB.prepare("SELECT member_id, status FROM payments WHERE event_id = ?")
    .bind(e.id)
    .all<{ member_id: string; status: string }>();
  const people = await env.DB.prepare(
    `SELECT id, username, is_owner FROM members WHERE id IN (SELECT member_id FROM registrations WHERE event_id = ?)`,
  )
    .bind(e.id)
    .all<{ id: string; username: string; is_owner: number }>();
  const ownerIds = new Set(people.results.filter((p) => p.is_owner === 1).map((p) => p.id));
  const usernames = new Map(people.results.map((p) => [p.id, p.username]));
  const prev = new Map(existing.map((p) => [p.member_id, p.status]));
  const billed = new Set(result.bills.map((b) => b.memberId));

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO settlements (event_id, court_total_cents, shuttle_count, shuttle_price_cents, registered_count,
         attended_count, court_share_cents, shuttle_share_cents, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO UPDATE SET court_total_cents = excluded.court_total_cents,
         shuttle_count = excluded.shuttle_count, shuttle_price_cents = excluded.shuttle_price_cents,
         registered_count = excluded.registered_count, attended_count = excluded.attended_count,
         court_share_cents = excluded.court_share_cents, shuttle_share_cents = excluded.shuttle_share_cents`,
    ).bind(
      e.id,
      input.courtTotalCents,
      input.shuttleCount,
      input.shuttlePriceCents,
      result.registered,
      result.attended,
      result.courtShareCents,
      result.shuttleShareCents,
      ts,
    ),
  ];
  for (const b of result.bills) {
    const status = prev.get(b.memberId);
    if (status === undefined) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status) VALUES (?, ?, ?, ?, 'unpaid')`,
        ).bind(e.id, b.memberId, b.totalCents, paymentCode(usernames.get(b.memberId) ?? "", e.date, e.code, b.memberId)),
      );
      if (ownerIds.has(b.memberId)) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
             SELECT id, amount_due_cents, 'manual', ? FROM payments WHERE event_id = ? AND member_id = ?`,
          ).bind(ts, e.id, b.memberId),
        );
      }
    } else if (status !== "paid") {
      stmts.push(
        env.DB.prepare("UPDATE payments SET amount_due_cents = ? WHERE event_id = ? AND member_id = ?").bind(
          b.totalCents,
          e.id,
          b.memberId,
        ),
      );
    }
  }
  for (const [memberId, status] of prev) {
    if (!billed.has(memberId) && status === "unpaid") {
      // Unpaid means no receipts, so nothing is lost.
      stmts.push(env.DB.prepare("DELETE FROM payments WHERE event_id = ? AND member_id = ?").bind(e.id, memberId));
    }
  }
  stmts.push(...syncPayments(env.DB, "event_id = ?", e.id));
  await env.DB.batch(stmts);
  return result;
}

export async function finalize(env: Env, e: EventRow, input: SettleInput): Promise<void> {
  const first = e.status !== "finalized";
  await applySettlement(env, e, input);
  await env.DB.batch([
    env.DB.prepare("UPDATE events SET status = 'finalized', finalized_at = COALESCE(finalized_at, ?) WHERE id = ?").bind(now(), e.id),
    setSetting(env.DB, "last_shuttle_price_cents", String(input.shuttlePriceCents)),
  ]);
  if (first) await notifyFinalized(env, e);
  await checkCollected(env, e.id);
}

/** After any roster, attendance or fee change on a finalized event, refresh the amounts. */
export async function recomputeIfFinalized(env: Env, e: EventRow): Promise<void> {
  if (e.status !== "finalized") return;
  const input = await savedInput(env, e.id);
  if (!input) return;
  await applySettlement(env, e, input);
  await checkCollected(env, e.id);
}

/**
 * Archives a finalized event once every payment row is paid (the requirements' definition of
 * 收齐: everyone marked paid, not totals compared). Returns true when it just archived.
 */
export async function checkCollected(env: Env, eventId: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE events SET status = 'settled', settled_at = ?
     WHERE id = ? AND status = 'finalized'
       AND NOT EXISTS (SELECT 1 FROM payments WHERE event_id = ? AND status != 'paid')`,
  )
    .bind(now(), eventId, eventId)
    .run();
  if (res.meta.changes === 0) return false;
  await notifyCollected(env, eventId);
  return true;
}

export async function paymentRows(env: Env, eventId: number): Promise<PaymentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.username, m.is_owner FROM payments p JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? ORDER BY CASE p.status WHEN 'paid' THEN 1 ELSE 0 END, m.username`,
  )
    .bind(eventId)
    .all<Record<string, any>>();
  const receipts = await receiptsFor(env, results.map((p) => p.id));
  return results.map((p) => ({
    id: p.id,
    memberId: p.member_id,
    memberName: p.username,
    isOwner: p.is_owner === 1,
    amountDueCents: p.amount_due_cents,
    paymentCode: p.payment_code,
    status: p.status,
    amountPaidCents: p.amount_paid_cents,
    refundCents: refundOf(p as never),
    receipts: receipts.get(p.id) ?? [],
  }));
}

/**
 * Recomputes the received total and status of the matching bills from their receipts:
 * nothing → unpaid, less than due → partial, due or more → paid (any excess is a refund).
 */
export function syncPayments(db: D1Database, where: string, ...args: unknown[]): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE payments SET amount_paid_cents =
           (SELECT COALESCE(SUM(amount_cents), 0) FROM payment_receipts WHERE payment_id = payments.id) WHERE ${where}`,
      )
      .bind(...args),
    db
      .prepare(
        `UPDATE payments SET
           status = CASE WHEN amount_paid_cents >= amount_due_cents THEN 'paid' WHEN amount_paid_cents > 0 THEN 'partial' ELSE 'unpaid' END,
           paid_at = CASE WHEN amount_paid_cents >= amount_due_cents THEN COALESCE(paid_at, ?) END
         WHERE ${where}`,
      )
      .bind(now(), ...args),
  ];
}

/** Adds one payment toward a bill and refreshes it. Returns false for a Venmo transaction seen before. */
export async function addReceipt(
  env: Env,
  paymentId: number,
  r: { amountCents: number; method: "venmo" | "manual"; txnId?: string | null; payerName?: string | null },
): Promise<boolean> {
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO payment_receipts (payment_id, amount_cents, method, venmo_txn_id, payer_name, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(paymentId, r.amountCents, r.method, r.txnId ?? null, r.payerName ?? null, now()),
    ...syncPayments(env.DB, "id = ?", paymentId),
  ]);
  return (ins?.meta.changes ?? 0) > 0;
}

export async function receiptsFor(env: Env, paymentIds: number[]): Promise<Map<number, Receipt[]>> {
  const out = new Map<number, Receipt[]>();
  if (paymentIds.length === 0) return out;
  const { results } = await env.DB.prepare(
    `SELECT * FROM payment_receipts WHERE payment_id IN (${paymentIds.map(() => "?").join(",")}) ORDER BY received_at, id`,
  )
    .bind(...paymentIds)
    .all<Record<string, any>>();
  for (const r of results) {
    const list = out.get(r.payment_id) ?? [];
    list.push({ id: r.id, amountCents: r.amount_cents, method: r.method, payerName: r.payer_name, receivedAt: r.received_at });
    out.set(r.payment_id, list);
  }
  return out;
}

export const refundOf = (p: { amount_paid_cents: number; amount_due_cents: number; refunded_cents: number }) =>
  Math.max(0, p.amount_paid_cents - p.amount_due_cents - p.refunded_cents);
