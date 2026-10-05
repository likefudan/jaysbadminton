import { getSettings, now } from "./db";
import type { Env } from "./env";
import { badRequest, str } from "./http";
import { eventPayee, ownerId } from "./organizers";

/**
 * 收款人 (docs/design/organizers.zh.md §6): whose account an event's money goes into, their payment
 * settings, and the checks around them. Reads of events.payee_id still go through eventPayee;
 * payeeSql is the same rule for queries that need it inside SQL.
 */

/** An event's payee inside SQL (`alias` is the events table's alias): NULL is the Owner, as in eventPayee. */
export const payeeSql = (alias: string) => `COALESCE(${alias}.payee_id, (SELECT id FROM members WHERE is_owner = 1))`;

/** An event's manager inside SQL, the same rule as eventManager: NULL is the Owner. */
export const managerSql = (alias: string) =>
  `COALESCE(${alias}.manager_id, (SELECT id FROM members WHERE is_owner = 1))`;

/** How bills and messages name a payee: 群主, or the organizer's name. */
export async function payeeName(db: D1Database, memberId: string | null): Promise<string> {
  if (!memberId) return "群主";
  const m = await db
    .prepare("SELECT username, is_owner FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ username: string; is_owner: number }>();
  return !m || m.is_owner === 1 ? "群主" : m.username;
}

/** How long a changed Venmo account keeps being recognized (payment_aliases). */
export const ALIAS_DAYS = 60;

export interface PaymentInput {
  venmo: string;
  mail: string;
  zelle: string;
}

/** The 收款设置 form, checked the same way for the Owner and for organizers. */
export function readPaymentInput(b: Record<string, unknown>): PaymentInput {
  const venmo = str(b.venmoUsername).trim().replace(/^@/, "");
  if (venmo && !/^[A-Za-z0-9_-]{2,30}$/.test(venmo)) throw badRequest("Venmo 用户名格式不对（不用加 @）");
  // Receipts are only trusted when addressed to this email (the signed To header), so it comes with the username.
  const mail = str(b.venmoEmail).trim().toLowerCase();
  if (venmo && !mail) throw badRequest("请填写 Venmo 通知邮箱（Venmo 账户里登记的邮箱）");
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw badRequest("Venmo 通知邮箱格式不对");
  const zelle = str(b.zelleAccount).trim().slice(0, 60);
  return { venmo, mail, zelle };
}

/**
 * A Venmo username or notification email can belong to one person only, or auto-matching could not
 * tell whose pocket a payment went into: the Owner's settings, every organizer's (former ones too,
 * as their old bills may still be paid), and accounts changed in the last 60 days. `memberId` is
 * whoever is saving (null for the Owner); their own entries never count against them.
 */
export async function assertAccountFree(db: D1Database, memberId: string | null, input: PaymentInput): Promise<void> {
  const check = async (field: "venmo_username" | "venmo_email", value: string, what: string) => {
    if (!value) return;
    const msg = `这个${what}已经是群主或其他组织者的收款账户（或 ${ALIAS_DAYS} 天内用过），请换一个`;
    if (memberId) {
      const s = await getSettings(db, [field]);
      if ((s[field] ?? "").toLowerCase() === value.toLowerCase()) throw badRequest(msg);
    }
    const taken = await db
      .prepare(
        `SELECT 1 FROM payment_profiles WHERE ${field} = ?1 AND member_id IS NOT ?2
         UNION ALL SELECT 1 FROM payment_aliases WHERE ${field} = ?1 AND member_id IS NOT ?2 AND until > ?3`,
      )
      .bind(value, memberId, now())
      .first();
    if (taken) throw badRequest(msg);
  };
  await check("venmo_username", input.venmo, " Venmo 用户名");
  await check("venmo_email", input.mail, " Venmo 通知邮箱");
}

/** Bills not yet paid in full, on events still collecting whose money goes to this person. */
export async function outstandingBills(db: D1Database, memberId: string): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM payments p JOIN events e ON e.id = p.event_id
       WHERE e.status = 'finalized' AND p.status != 'paid' AND ${payeeSql("e")} = ?`,
    )
    .bind(memberId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export interface ProfileChange {
  /** Field, before, after; only what changed. */
  changes: [string, string, string][];
}

/**
 * Saves an organizer's 我的收款设置 (payment_profiles). Changing the Venmo account while bills are
 * still being paid keeps the old one recognized for 60 days (payment_aliases): those members may
 * already have paid it. Clearing the Venmo username then is refused, as the bills would show no
 * way to pay.
 */
export async function savePaymentProfile(env: Env, memberId: string, input: PaymentInput): Promise<ProfileChange> {
  const db = env.DB;
  await assertAccountFree(db, memberId, input);
  const before = await db
    .prepare("SELECT venmo_username, venmo_email, zelle_account FROM payment_profiles WHERE member_id = ?")
    .bind(memberId)
    .first<{ venmo_username: string | null; venmo_email: string | null; zelle_account: string | null }>();
  const oldVenmo = before?.venmo_username ?? "";
  const oldMail = before?.venmo_email ?? "";
  const accountChanged =
    oldVenmo.toLowerCase() !== input.venmo.toLowerCase() || oldMail.toLowerCase() !== input.mail.toLowerCase();
  const owed = accountChanged && oldVenmo ? await outstandingBills(db, memberId) : 0;
  if (owed > 0 && !input.venmo) throw badRequest(`还有 ${owed} 张账单没收齐，不能清空 Venmo 用户名；可以换成新的账户`);

  const ts = now();
  const stmts: D1PreparedStatement[] = [
    // Expired aliases go, and so does one for the account being taken back into use.
    db.prepare("DELETE FROM payment_aliases WHERE until <= ?").bind(ts),
    db
      .prepare("DELETE FROM payment_aliases WHERE member_id = ? AND venmo_username = ? AND venmo_email = ?")
      .bind(memberId, input.venmo, input.mail),
  ];
  if (owed > 0 && oldVenmo && oldMail)
    stmts.push(
      db
        .prepare(
          `INSERT INTO payment_aliases (venmo_username, venmo_email, member_id, until) VALUES (?, ?, ?, ?)
           ON CONFLICT (venmo_username, venmo_email) DO UPDATE SET member_id = excluded.member_id, until = excluded.until`,
        )
        .bind(oldVenmo, oldMail, memberId, new Date(Date.now() + ALIAS_DAYS * 86400_000).toISOString()),
    );
  stmts.push(
    db
      .prepare(
        `INSERT INTO payment_profiles (member_id, venmo_username, venmo_email, zelle_account, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (member_id) DO UPDATE SET venmo_username = ?2, venmo_email = ?3, zelle_account = ?4, updated_at = ?5`,
      )
      .bind(memberId, input.venmo || null, input.mail || null, input.zelle || null, ts),
  );
  try {
    await db.batch(stmts);
  } catch (err) {
    // Someone else saved the same account in between: the UNIQUE columns refuse the second.
    if (String(err).includes("UNIQUE")) throw badRequest("这个 Venmo 账户已经是其他人的收款账户，请换一个");
    throw err;
  }
  const changes: [string, string, string][] = [
    ["Venmo", oldVenmo ? `@${oldVenmo}` : "", input.venmo ? `@${input.venmo}` : ""],
    ["Venmo 通知邮箱", oldMail, input.mail],
    ["Zelle", before?.zelle_account ?? "", input.zelle],
  ];
  return { changes: changes.filter(([, a, z]) => a !== z) };
}

/**
 * Finalize sends bills that point at the payee's Venmo, and auto-matching needs both the username
 * and the notification email. The Owner may still finalize without them, as before.
 */
export async function assertPayeeReady(env: Env, e: { payee_id: string | null }, actorId: string | null) {
  const payee = await eventPayee(env.DB, e);
  if (!payee || payee === (await ownerId(env.DB))) return;
  const p = await env.DB.prepare("SELECT venmo_username, venmo_email FROM payment_profiles WHERE member_id = ?")
    .bind(payee)
    .first<{ venmo_username: string | null; venmo_email: string | null }>();
  if (p?.venmo_username && p.venmo_email) return;
  throw badRequest(
    payee === actorId
      ? "请先在收款设置里填好 Venmo 和通知邮箱"
      : `本场收款人 ${await payeeName(env.DB, payee)} 还没在收款设置里填好 Venmo 和通知邮箱`,
  );
}

/** The same rule inside SQL (`alias` is the events table's alias): no Finalize yet and no bills. */
export const payeeUnlockedSql = (alias: string) =>
  `(${alias}.finalized_at IS NULL AND NOT EXISTS (SELECT 1 FROM payments WHERE event_id = ${alias}.id))`;

/**
 * The payee is fixed once bills exist (from the first Finalize): bills already sent, and members
 * who already paid, point at that account. Anything that changes events.payee_id checks this first.
 */
export async function assertPayeeUnlocked(db: D1Database, eventId: number): Promise<void> {
  const locked = await db
    .prepare(`SELECT 1 FROM events e WHERE e.id = ? AND NOT ${payeeUnlockedSql("e")}`)
    .bind(eventId)
    .first();
  if (locked) throw badRequest("这场已经结算发出账单，收款人不能再换");
}
