import { getSettings } from "./db";
import type { Env } from "./env";

/**
 * 组织者 (docs/design/organizers.zh.md): who someone is, what that lets them do, and whose account an
 * event's money goes into. Every read of events.manager_id / payee_id goes through here, so a NULL
 * (an event from before 0023, or one created by older code after a rollback) always means the Owner.
 */

export type Role = "owner" | "admin" | "organizer" | "member";

/**
 * What a role may do (organizers.zh.md §10.1, admin-role.zh.md §4). Admin routes register the
 * capability they need rather than a role, so a role is one line in ROLE_CAPABILITIES.
 * - owner: the Owner's alone: appointing admins, wiping the database, secrets and the Owner's own
 *   sign-in and payment settings, and every delete that can't be undone
 * - data: reading the whole group's data out (exports, the Sheets and forwarding status), read-only
 * - group: running the group (members, links, notes, global settings, appointing organizers, and
 *   every event and payment as if it were one's own)
 * - events.create: creating events
 * - event: managing an event one is responsible for (every event, with `group`)
 * - payee: payments that went into one's own account (every payment, with `group`)
 * - members.read: the member and pending pages, read-only and without personal links
 * - self: one's own payment settings and Telegram
 */
export type Capability = "owner" | "data" | "group" | "events.create" | "event" | "payee" | "members.read" | "self";

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
  admin: ["data", "group", "events.create", "event", "payee", "members.read", "self"],
  organizer: ["events.create", "event", "payee", "members.read", "self"],
  member: [],
};

export const can = (role: Role, cap: Capability) => ROLE_CAPABILITIES[role].includes(cap);

/** What the site calls each role. */
export const ROLE_TITLE: Record<Role, string> = { owner: "群主", admin: "管理员", organizer: "组织者", member: "成员" };

/**
 * 管理员 and 组织者: appointed (members.role), signing in with Google, running events and taking
 * payments into their own account. The Owner is not one: their settings live elsewhere.
 */
export const STAFF_ROLES = ["admin", "organizer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaff = (role: string): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);
/** STAFF_ROLES as an SQL list: `role IN ${STAFF_SQL}`. */
export const STAFF_SQL = `(${STAFF_ROLES.map((r) => `'${r}'`).join(", ")})`;

/** The rollout switch: it gates every way into the organizer and admin features, never where money goes. */
export const organizersEnabled = (env: Pick<Env, "ORGANIZERS">) => env.ORGANIZERS === "1";

export interface RoleFields {
  is_owner: number;
  role: string;
  status: string;
  deleted_at: string | null;
}

/** Read from the database on every request, so revoking an organizer or admin takes effect at once. */
export function memberRole(env: Pick<Env, "ORGANIZERS">, m: RoleFields): Role {
  if (m.is_owner === 1) return "owner";
  if (isStaff(m.role) && m.status === "active" && !m.deleted_at && organizersEnabled(env)) return m.role;
  return "member";
}

/** memberRole's admin or organizer inside SQL (`alias` is the members table's); the flag is checked in code. */
export const currentStaffSql = (alias: string) =>
  `${alias}.is_owner = 0 AND ${alias}.role IN ${STAFF_SQL} AND ${alias}.status = 'active' AND ${alias}.deleted_at IS NULL`;

/** The Owner's member id; null before first-time setup (or right after 清空所有数据). */
export async function ownerId(db: D1Database): Promise<string | null> {
  return (await db.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())?.id ?? null;
}

/**
 * 记住上次的值 (time, deadline, venue, shuttle price) are kept per person: the Owner's in the
 * original `last_xxx` keys (so nothing moves for them, and a rollback still finds them), an
 * organizer's in `last_xxx:<member id>`. Reading falls back to the Owner's until they have their own.
 */
export const lastKey = (key: string, memberId: string | null, owner: string | null) =>
  !memberId || memberId === owner ? key : `${key}:${memberId}`;

/**
 * Forgets `value` as everyone's remembered `key` (e.g. a venue removed from 最近的场馆). An
 * organizer's own is emptied rather than deleted, so they don't fall back to the Owner's.
 */
export const forgetLastValue = (db: D1Database, key: string, value: string) => [
  db.prepare("DELETE FROM settings WHERE key = ? AND value = ?").bind(key, value),
  db.prepare("UPDATE settings SET value = '' WHERE key LIKE ? AND value = ?").bind(`${key}:%`, value),
];

/** The person's remembered values for `keys`, each from their own key or else the Owner's. */
export async function lastValues(
  db: D1Database,
  memberId: string | null,
  keys: string[],
): Promise<Record<string, string | undefined>> {
  const owner = await ownerId(db);
  const saved = await getSettings(db, [...new Set([...keys, ...keys.map((k) => lastKey(k, memberId, owner))])]);
  return Object.fromEntries(keys.map((k) => [k, saved[lastKey(k, memberId, owner)] ?? saved[k]]));
}

/** 本场负责人: who manages the event. */
export async function eventManager(db: D1Database, e: { manager_id: string | null }): Promise<string | null> {
  return e.manager_id ?? ownerId(db);
}

/** 本场收款人: whose Venmo / Zelle the bills show and whose account auto-matching accepts. */
export async function eventPayee(db: D1Database, e: { payee_id: string | null }): Promise<string | null> {
  return e.payee_id ?? ownerId(db);
}

/** Whose account a received payment (inbound_payments) went into. */
export async function inboundPayee(db: D1Database, i: { payee_id: string | null }): Promise<string | null> {
  return i.payee_id ?? ownerId(db);
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
