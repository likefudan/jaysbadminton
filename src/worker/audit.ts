import type { AuditEntry } from "../shared/types";
import type { Actor } from "./access";
import { now } from "./db";
import type { Env } from "./env";
import { friendLabel } from "./events";
import { dollars } from "../shared/settle";

/**
 * 操作记录 (docs/design/organizers.zh.md §9): who changed what on an event, so that with several
 * people handling money "谁改的" has an answer. Written by the admin endpoints that change an
 * event's roster, fees, bills or hands, and by auto-matching as `system`. Members' own sign-ups
 * are not recorded. The rows go with the event when it is deleted for good (events.ts deleteEvent).
 */

/** actor_id of what the site did by itself: Venmo auto-matching and archiving once everyone paid. */
export const SYSTEM = "system";

/** actor_id of the Owner before their member record exists (the link login at first setup). */
const OWNER = "owner";

export type AuditAction =
  | "create"
  | "edit"
  | "close_now"
  | "reopen"
  | "cancel"
  | "transfer"
  | "reassign"
  | "roster_add"
  | "roster_rename"
  | "roster_remove"
  | "self_signup"
  | "self_cancel"
  | "attendance"
  | "finalize"
  | "fee_edit"
  | "mark_paid"
  | "receipt_remove"
  | "refund"
  | "inbound_link"
  | "inbound_ignore"
  | "dunning_stop"
  | "dunning_resume"
  | "auto_match"
  | "collected";

/** Who did it, as stored: the admin page's caller. */
export const actorId = (actor: Actor): string => actor.memberId ?? OWNER;

/** The statement that records one entry, for a batch that should record it only alongside its change. */
export function auditStatement(
  db: D1Database,
  eventId: number,
  actor: string,
  action: AuditAction,
  detail: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO event_audit (event_id, actor_id, action, detail, at) VALUES (?, ?, ?, ?, ?)")
    .bind(eventId, actor, action, detail.slice(0, 500), now());
}

/**
 * Records one entry after the change it describes has happened. A failure here is logged rather
 * than thrown: the change itself already went through, and an error would invite a second click.
 */
export async function audit(env: Env, eventId: number, actor: string, action: AuditAction, detail: string) {
  try {
    await auditStatement(env.DB, eventId, actor, action, detail).run();
  } catch (err) {
    console.error("event_audit insert failed", { eventId, action, err });
  }
}

/** The event's log, newest first, with each actor named (群主, the organizer, or 系统). */
export async function auditRows(env: Env, eventId: number): Promise<AuditEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.actor_id, a.action, a.detail, a.at, m.username, m.is_owner
     FROM event_audit a LEFT JOIN members m ON m.id = a.actor_id
     WHERE a.event_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 500`,
  )
    .bind(eventId)
    .all<{
      id: number;
      actor_id: string;
      action: string;
      detail: string | null;
      at: string;
      username: string | null;
      is_owner: number | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    detail: r.detail ?? "",
    actor:
      r.actor_id === SYSTEM ? "系统" : r.actor_id === OWNER || r.is_owner === 1 ? "群主" : (r.username ?? r.actor_id),
  }));
}

/** How the log names a roster row: the member, or "<member>的朋友<n>" / the friend's name. */
export async function rosterLabel(env: Env, registrationId: number): Promise<string | null> {
  const r = await env.DB.prepare(
    `SELECT r.friend_index, r.friend_name, m.username FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.id = ?`,
  )
    .bind(registrationId)
    .first<{ friend_index: number; friend_name: string | null; username: string }>();
  if (!r) return null;
  return r.friend_index === 0
    ? r.username
    : `${friendLabel(r.username, r.friend_index, r.friend_name)}（${r.username} 带的朋友）`;
}

/** A bill as the log names it: whose it is and the event it belongs to. */
export async function billInfo(
  env: Env,
  paymentId: number,
): Promise<{ eventId: number; who: string; dueCents: number } | null> {
  const p = await env.DB.prepare(
    `SELECT p.event_id, p.amount_due_cents, m.username FROM payments p JOIN members m ON m.id = p.member_id
     WHERE p.id = ?`,
  )
    .bind(paymentId)
    .first<{ event_id: number; amount_due_cents: number; username: string }>();
  return p && { eventId: p.event_id, who: p.username, dueCents: p.amount_due_cents };
}

export const money = (cents: number) => `$${dollars(cents)}`;
