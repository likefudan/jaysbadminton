import { settle, type SettleInput, type Settlement, type SettleRow } from "../shared/settle";
import type { PaymentRow, Receipt, RosterEntry } from "../shared/types";
import { now, setSetting } from "./db";
import { notifyCollected, notifyFinalized } from "./notify";
import { paymentCode } from "./paymentCode";
import type { Env } from "./env";
import { type EventRow, roster } from "./events";
import { HttpError, badRequest } from "./http";
import { eventPayee } from "./organizers";

export async function settleRows(env: Env, eventId: number): Promise<SettleRow[]> {
  return toSettleRows(await roster(env, eventId));
}

export const toSettleRows = (list: RosterEntry[]): SettleRow[] =>
  list.map((r) => ({ memberId: r.memberId, friendIndex: r.friendIndex, name: r.name, attended: r.attended }));

export async function savedInput(env: Env, eventId: number): Promise<SettleInput | null> {
  const s = await env.DB.prepare(
    "SELECT court_total_cents, shuttle_count, shuttle_price_cents FROM settlements WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ court_total_cents: number; shuttle_count: number; shuttle_price_cents: number }>();
  return s
    ? { courtTotalCents: s.court_total_cents, shuttleCount: s.shuttle_count, shuttlePriceCents: s.shuttle_price_cents }
    : null;
}

const PAYEE_CHANGED = "payee changed";

/**
 * Writes the settlement and brings the payment rows in line with it. Every row follows the new
 * amounts, paid ones included, so a corrected fee is shared by everyone: a member who already paid
 * the old amount ends up owing the difference (partial) or due a refund. The payee's own bill (the
 * Owner's on their events, an organizer's on theirs, friends they brought included) is always paid
 * in full with one manual receipt that tracks the amount: they would only be paying themselves. A member who left the roster
 * loses a bill that never received anything; one with payments on it (even if all refunded) is
 * kept at nothing owed, so its history stays and linked Venmo payments still point at it.
 */
export async function applySettlement(env: Env, e: EventRow, input: SettleInput): Promise<Settlement> {
  const result = settle(await settleRows(env, e.id), input);
  const ts = now();
  const { results: existing } = await env.DB.prepare(
    `SELECT member_id, status,
       EXISTS (SELECT 1 FROM payment_receipts r WHERE r.payment_id = payments.id) AS has_receipts,
       EXISTS (SELECT 1 FROM payment_receipts r WHERE r.payment_id = payments.id AND r.method != 'manual') AS has_others
     FROM payments WHERE event_id = ?`,
  )
    .bind(e.id)
    .all<{ member_id: string; status: string; has_receipts: number; has_others: number }>();
  const people = await env.DB.prepare(
    "SELECT id, username FROM members WHERE id IN (SELECT member_id FROM registrations WHERE event_id = ?)",
  )
    .bind(e.id)
    .all<{ id: string; username: string }>();
  // Read on every recompute rather than kept, so the rule always follows events.payee_id.
  const payee = await eventPayee(env.DB, e);
  const paysSelf = (memberId: string) => memberId === payee;
  const usernames = new Map(people.results.map((p) => [p.id, p.username]));
  const prev = new Map(existing.map((p) => [p.member_id, p.status]));
  const history = new Map(existing.map((p) => [p.member_id, p]));
  const billed = new Set(result.bills.map((b) => b.memberId));

  const stmts: D1PreparedStatement[] = [
    // The bills below follow `e`'s payee, and whoever is acting was allowed to by `e`'s manager. A
    // 转交 or 撤销 that moved either since `e` was read fails the whole batch rather than billing
    // for the wrong person: json() of a non-JSON string is an error, raised only when the row matches.
    env.DB.prepare(
      `SELECT json('${PAYEE_CHANGED}') FROM events WHERE id = ?1 AND (payee_id IS NOT ?2 OR manager_id IS NOT ?3)`,
    ).bind(e.id, e.payee_id, e.manager_id),
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
        ).bind(e.id, b.memberId, b.totalCents, paymentCode(usernames.get(b.memberId) ?? "", e.number, b.memberId)),
      );
      if (paysSelf(b.memberId)) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
             SELECT id, amount_due_cents, 'manual', ? FROM payments WHERE event_id = ? AND member_id = ?`,
          ).bind(ts, e.id, b.memberId),
        );
      }
    } else {
      stmts.push(
        env.DB.prepare("UPDATE payments SET amount_due_cents = ? WHERE event_id = ? AND member_id = ?").bind(
          b.totalCents,
          e.id,
          b.memberId,
        ),
      );
      if (paysSelf(b.memberId)) {
        // The payee pays themselves, so their manual receipt is redone at the new amount, less
        // anything else on the bill (a Venmo payment linked to it stays, with its refunds).
        stmts.push(
          env.DB.prepare(
            "DELETE FROM payment_receipts WHERE method = 'manual' AND payment_id = (SELECT id FROM payments WHERE event_id = ? AND member_id = ?)",
          ).bind(e.id, b.memberId),
          env.DB.prepare(
            `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
             SELECT id, amount_due_cents - (SELECT COALESCE(SUM(amount_cents), 0) FROM payment_receipts WHERE payment_id = payments.id),
               'manual', ?
             FROM payments WHERE event_id = ? AND member_id = ?
               AND amount_due_cents > (SELECT COALESCE(SUM(amount_cents), 0) FROM payment_receipts WHERE payment_id = payments.id)`,
          ).bind(ts, e.id, b.memberId),
        );
      }
    }
  }
  for (const memberId of prev.keys()) {
    if (billed.has(memberId)) continue;
    const h = history.get(memberId)!;
    if (!h.has_receipts || (paysSelf(memberId) && !h.has_others)) {
      // Nothing was ever received, or only the payee's own manual receipts: nothing is lost.
      stmts.push(
        env.DB.prepare(
          "DELETE FROM payment_receipts WHERE payment_id = (SELECT id FROM payments WHERE event_id = ? AND member_id = ?)",
        ).bind(e.id, memberId),
        env.DB.prepare("DELETE FROM payments WHERE event_id = ? AND member_id = ?").bind(e.id, memberId),
      );
    } else {
      // Paid something but no longer on the roster: owes nothing, so whatever is kept is a refund.
      // "Unpaid" is not enough to drop it: a payment refunded in full nets to unpaid too.
      if (paysSelf(memberId))
        // The payee's own manual receipts only ever matched their share, which is now nothing.
        stmts.push(
          env.DB.prepare(
            "DELETE FROM payment_receipts WHERE method = 'manual' AND payment_id = (SELECT id FROM payments WHERE event_id = ? AND member_id = ?)",
          ).bind(e.id, memberId),
        );
      stmts.push(
        env.DB.prepare("UPDATE payments SET amount_due_cents = 0 WHERE event_id = ? AND member_id = ?").bind(
          e.id,
          memberId,
        ),
      );
    }
  }
  stmts.push(...syncPayments(env.DB, "event_id = ?", e.id));
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (String(err).includes("malformed JSON"))
      throw new HttpError(409, "payee_changed", "这场活动的负责人或收款人刚刚换了，请刷新页面后再试");
    throw err;
  }
  return result;
}

export async function finalize(env: Env, e: EventRow, input: SettleInput): Promise<void> {
  const first = e.status !== "finalized";
  await applySettlement(env, e, input);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE events SET status = 'finalized', finalized_at = COALESCE(finalized_at, ?) WHERE id = ?",
    ).bind(now(), e.id),
    setSetting(env.DB, "last_shuttle_price_cents", String(input.shuttlePriceCents)),
  ]);
  if (first) await notifyFinalized(env, e);
  await checkCollected(env, e.id);
}

/**
 * After Finalize the fees are fixed, so a roster or attendance change must still leave someone to
 * share them. Refused when the change would leave nobody to split the shuttles, or empty a list
 * that has a court fee; recomputing would otherwise quietly drop that cost (and an emptied event
 * would archive itself). If that is really what happened, the fees are corrected first.
 */
export async function assertCostsShared(
  env: Env,
  e: EventRow,
  change: (list: RosterEntry[]) => RosterEntry[],
): Promise<void> {
  if (e.status !== "finalized") return;
  const input = await savedInput(env, e.id);
  if (!input) return;
  const before = await roster(env, e.id);
  const after = change(before);
  const shuttles = input.shuttleCount * input.shuttlePriceCents;
  if (before.length > 0 && after.length === 0 && (input.courtTotalCents > 0 || shuttles > 0))
    throw badRequest(
      "已经结算的活动不能把名单删空，否则费用没人分摊。如果活动其实没办成，请先在下面把费用都改成 0 并保存",
    );
  if (shuttles > 0 && before.some((r) => r.attended) && after.length > 0 && !after.some((r) => r.attended))
    throw badRequest("这样就没有人到场了，球费没人分摊。如果确实没人用球，请先在下面把用球个数改成 0 并保存");
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

export async function paymentRows(env: Env, e: EventRow): Promise<PaymentRow[]> {
  const payee = await eventPayee(env.DB, e);
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.username FROM payments p JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? ORDER BY CASE p.status WHEN 'paid' THEN 1 ELSE 0 END, m.username`,
  )
    .bind(e.id)
    .all<Record<string, any>>();
  const receipts = await receiptsFor(
    env,
    results.map((p) => p.id),
  );
  return results.map((p) => ({
    id: p.id,
    memberId: p.member_id,
    memberName: p.username,
    isPayee: p.member_id === payee,
    amountDueCents: p.amount_due_cents,
    paymentCode: p.payment_code,
    status: p.status,
    amountPaidCents: p.amount_paid_cents,
    refundCents: refundOf(p as never),
    receipts: receipts.get(p.id) ?? [],
  }));
}

/**
 * Recomputes the received total and status of the matching bills from their receipts. Refunds are
 * receipts with a negative amount, so the total is net of them: nothing → unpaid, less than due →
 * partial, due or more → paid (any excess is still to be refunded).
 */
export function syncPayments(db: D1Database, where: string, ...args: unknown[]): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE payments SET amount_paid_cents =
           (SELECT COALESCE(SUM(amount_cents), 0) FROM payment_receipts WHERE payment_id = payments.id),
         refunded_cents =
           (SELECT COALESCE(-SUM(amount_cents), 0) FROM payment_receipts WHERE payment_id = payments.id AND method = 'refund')
         WHERE ${where}`,
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
  r: {
    amountCents: number;
    method: "venmo" | "manual";
    txnId?: string | null;
    payerName?: string | null;
    /** A Venmo payment's note, kept so undoing it can show it again in 待确认. */
    note?: string | null;
    /** The 待确认 row it was linked from, which undoing it reopens. */
    inboundId?: number | null;
  },
): Promise<boolean> {
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO payment_receipts (payment_id, amount_cents, method, venmo_txn_id, payer_name, received_at, note, inbound_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      paymentId,
      r.amountCents,
      r.method,
      r.txnId ?? null,
      r.payerName ?? null,
      now(),
      r.note ?? null,
      r.inboundId ?? null,
    ),
    ...syncPayments(env.DB, "id = ?", paymentId),
  ]);
  return (ins?.meta.changes ?? 0) > 0;
}

/**
 * 标记已付: a manual receipt for whatever is still owed, worked out inside the same transaction,
 * so a second click (another tab, a retried request) finds nothing owed and adds nothing.
 * Returns false when the bill was already paid.
 */
export async function markPaid(env: Env, paymentId: number): Promise<boolean> {
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
       SELECT id, amount_due_cents - amount_paid_cents, 'manual', ? FROM payments
       WHERE id = ? AND amount_paid_cents < amount_due_cents`,
    ).bind(now(), paymentId),
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
    list.push({
      id: r.id,
      amountCents: r.amount_cents,
      // Linked Venmo payments saved before receipts had a method of their own are 'manual' with a transaction.
      method: r.method === "manual" && r.venmo_txn_id ? "venmo" : r.method,
      payerName: r.payer_name,
      receivedAt: r.received_at,
    });
    out.set(r.payment_id, list);
  }
  return out;
}

/** amount_paid_cents is net of refunds, so whatever is above the bill is still owed back. */
export const refundOf = (p: { amount_paid_cents: number; amount_due_cents: number }) =>
  Math.max(0, p.amount_paid_cents - p.amount_due_cents);
