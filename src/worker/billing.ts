import { paymentCode, settle, type SettleInput, type Settlement, type SettleRow } from "../shared/settle";
import type { PaymentRow } from "../shared/types";
import { now, setSetting } from "./db";
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
 * Writes the settlement and brings the payment rows in line with it. Unpaid rows follow the new
 * amounts; paid and anomaly rows are left alone (the Owner settles differences by hand). The
 * Owner's own bill is marked paid. A member who left the roster loses an unpaid row.
 */
export async function applySettlement(env: Env, e: EventRow, input: SettleInput): Promise<Settlement> {
  const result = settle(await settleRows(env, e.id), input);
  const ts = now();
  const { results: existing } = await env.DB.prepare("SELECT member_id, status FROM payments WHERE event_id = ?")
    .bind(e.id)
    .all<{ member_id: string; status: string }>();
  const owners = await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").all<{ id: string }>();
  const ownerIds = new Set(owners.results.map((o) => o.id));
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
      const owner = ownerIds.has(b.memberId);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, method, amount_paid_cents, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          e.id,
          b.memberId,
          b.totalCents,
          paymentCode(e.code, b.memberId),
          owner ? "paid" : "unpaid",
          owner ? "manual" : null,
          owner ? b.totalCents : null,
          owner ? ts : null,
        ),
      );
    } else if (status === "unpaid") {
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
      stmts.push(env.DB.prepare("DELETE FROM payments WHERE event_id = ? AND member_id = ?").bind(e.id, memberId));
    }
  }
  await env.DB.batch(stmts);
  return result;
}

export async function finalize(env: Env, e: EventRow, input: SettleInput): Promise<void> {
  await applySettlement(env, e, input);
  await env.DB.batch([
    env.DB.prepare("UPDATE events SET status = 'finalized', finalized_at = COALESCE(finalized_at, ?) WHERE id = ?").bind(now(), e.id),
    setSetting(env.DB, "last_shuttle_price_cents", String(input.shuttlePriceCents)),
  ]);
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
  return res.meta.changes > 0;
}

export async function paymentRows(env: Env, eventId: number): Promise<PaymentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.username, m.is_owner FROM payments p JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? ORDER BY CASE p.status WHEN 'paid' THEN 1 ELSE 0 END, m.username`,
  )
    .bind(eventId)
    .all<Record<string, never>>();
  return results.map((p: Record<string, any>) => ({
    id: p.id,
    memberId: p.member_id,
    memberName: p.username,
    isOwner: p.is_owner === 1,
    amountDueCents: p.amount_due_cents,
    paymentCode: p.payment_code,
    status: p.status,
    method: p.method,
    amountPaidCents: p.amount_paid_cents,
    paidAt: p.paid_at,
  }));
}
