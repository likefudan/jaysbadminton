import { getSettings } from "./db";
import type { Env } from "./env";

/**
 * 组织者 (docs/design/organizers.zh.md): who someone is, what that lets them do, and whose account an
 * event's money goes into. Every read of events.manager_id / payee_id goes through here, so a NULL
 * (an event from before 0023, or one created by older code after a rollback) always means the Owner.
 */

export type Role = "owner" | "organizer" | "member";

/**
 * What a role may do (design §10.1). Admin routes register the capability they need rather than
 * "Owner only", so a future role (管理员) is one more line in ROLE_CAPABILITIES.
 * - system: database-level and account security (permanent deletes, reset, password, export, Sheets)
 * - group: running the group (members, links, notes, global settings, appointing organizers, and
 *   every event and payment as if it were one's own)
 * - events.create: creating events
 * - event: managing an event one is responsible for (every event, with `group`)
 * - payee: payments that went into one's own account (every payment, with `group`)
 * - members.read: the member and pending pages, read-only and without personal links
 * - self: one's own payment settings and Telegram
 */
export type Capability = "system" | "group" | "events.create" | "event" | "payee" | "members.read" | "self";

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ["system", "group", "events.create", "event", "payee", "members.read", "self"],
  organizer: ["events.create", "event", "payee", "members.read", "self"],
  member: [],
};

export const can = (role: Role, cap: Capability) => ROLE_CAPABILITIES[role].includes(cap);

/** The rollout switch: it gates every way into the organizer features, never where money goes. */
export const organizersEnabled = (env: Pick<Env, "ORGANIZERS">) => env.ORGANIZERS === "1";

interface RoleFields {
  is_owner: number;
  role: string;
  status: string;
  deleted_at: string | null;
}

/** Read from the database on every request, so revoking an organizer takes effect at once. */
export function memberRole(env: Pick<Env, "ORGANIZERS">, m: RoleFields): Role {
  if (m.is_owner === 1) return "owner";
  if (m.role === "organizer" && m.status === "active" && !m.deleted_at && organizersEnabled(env)) return "organizer";
  return "member";
}

/** The Owner's member id; null before first-time setup (or right after 清空所有数据). */
export async function ownerId(db: D1Database): Promise<string | null> {
  return (await db.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())?.id ?? null;
}

/** 本场负责人: who manages the event. */
export async function eventManager(db: D1Database, e: { manager_id: string | null }): Promise<string | null> {
  return e.manager_id ?? ownerId(db);
}

/** 本场收款人: whose Venmo / Zelle the bills show and whose account auto-matching accepts. */
export async function eventPayee(db: D1Database, e: { payee_id: string | null }): Promise<string | null> {
  return e.payee_id ?? ownerId(db);
}

export interface PayeeProfile {
  memberId: string;
  venmoUsername: string;
  venmoEmail: string;
  zelleAccount: string;
}

/**
 * Where to pay someone: the Owner's settings (they stay in `settings`, so a rollback loses nothing),
 * or an organizer's payment_profiles row. Null when nothing is filled in (no Venmo username and no
 * Zelle), whoever they are, or when the member does not exist.
 */
export async function payeeProfile(db: D1Database, memberId: string | null): Promise<PayeeProfile | null> {
  if (!memberId) return null;
  const m = await db.prepare("SELECT is_owner FROM members WHERE id = ?").bind(memberId).first<{ is_owner: number }>();
  if (!m) return null;
  let p: { venmo_username?: string | null; venmo_email?: string | null; zelle_account?: string | null } | null;
  if (m.is_owner === 1) p = await getSettings(db, ["venmo_username", "venmo_email", "zelle_account"]);
  else
    p = await db
      .prepare("SELECT venmo_username, venmo_email, zelle_account FROM payment_profiles WHERE member_id = ?")
      .bind(memberId)
      .first();
  if (!p?.venmo_username && !p?.zelle_account) return null;
  return {
    memberId,
    venmoUsername: p.venmo_username ?? "",
    venmoEmail: p.venmo_email ?? "",
    zelleAccount: p.zelle_account ?? "",
  };
}
