import { now } from "./db";
import type { Env } from "./env";
import { LIVE_SQL } from "./events";
import { badRequest } from "./http";
import type { MemberRow } from "./members";
import { isStaff } from "./organizers";

/**
 * What a deleted member is called from then on. Their rows on old rosters and bills stay, so the
 * group's accounts still add up, but nothing on them says who it was.
 */
export const erasedName = (m: Pick<MemberRow, "id">) => `已删除成员（${m.id}）`;

/**
 * 删除账号, asked for by the member themselves: refused while the group still needs them as a
 * person (roles, money owed, a list that is not settled yet).
 */
export async function assertMayEraseSelf(env: Env, m: MemberRow): Promise<void> {
  if (m.is_owner) throw badRequest("群主不能删除自己的账号，请先把群主转交给别人");
  if (isStaff(m.role)) throw badRequest("你还有管理员或组织者身份，请先让群主撤销，再删除账号");
  const owing = await env.DB.prepare(
    "SELECT SUM(amount_due_cents - amount_paid_cents) AS owing FROM payments WHERE member_id = ? AND status != 'paid'",
  )
    .bind(m.id)
    .first<{ owing: number | null }>();
  if ((owing?.owing ?? 0) > 0)
    throw badRequest(`你还有 $${((owing?.owing ?? 0) / 100).toFixed(2)} 没付清，付清之后才能删除账号`);
  const pending = await env.DB.prepare(
    `SELECT e.date FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE (r.member_id = ?1 OR r.paid_by = ?1) AND e.status IN ('open', 'closed', 'finalized') ORDER BY e.start_at LIMIT 1`,
  )
    .bind(m.id)
    .first<{ date: string }>();
  if (pending)
    throw badRequest(`你还在 ${pending.date} 活动的名单上。请先取消报名，或者等这场结算、收齐之后，再删除账号`);
  const running = await env.DB.prepare(
    `SELECT date FROM events WHERE (payee_id = ?1 OR manager_id = ?1) AND status IN ${LIVE_SQL} ORDER BY start_at LIMIT 1`,
  )
    .bind(m.id)
    .first<{ date: string }>();
  if (running) throw badRequest(`你负责的 ${running.date} 活动还没收齐归档，之后才能删除账号`);
}

/**
 * Deletes a member for good: sign-in, name, contact details, notes, pictures and everything they
 * recorded about themselves go. Roster and bill rows stay under 「已删除成员（M012）」, and the ID
 * is never reused. Answers whether this call was the one that deleted them.
 */
export async function eraseMember(env: Env, m: MemberRow, again = false): Promise<boolean> {
  const db = env.DB;
  const name = erasedName(m);
  // Deleted before deleting meant everything: the name was kept as 「Alice（M004）」.
  const suffix = `（${m.id}）`;
  const was = again && m.username.endsWith(suffix) ? m.username.slice(0, -suffix.length) : m.username;
  const gone = (sql: string) => db.prepare(sql).bind(m.id);
  const [deleted] = await db.batch([
    db
      .prepare(
        `UPDATE members SET deleted_at = COALESCE(deleted_at, ?1), status = 'inactive', username = ?2, wechat_nickname = '',
           token_hash = NULL, token_enc = NULL, google_sub = NULL, google_email = NULL, google_picture = NULL,
           avatar = NULL, email = NULL, applicant_name = NULL, wechat_account = NULL, application_message = NULL,
           admin_note = NULL, approval_email_status = NULL, approval_email_sent_at = NULL, link_resent_at = NULL,
           calorie_board = 0, calorie_shortcut_v = NULL
         WHERE id = ?3 AND (deleted_at IS NULL OR ?4)`,
      )
      .bind(now(), name, m.id, again ? 1 : 0),
    ...(m.google_sub ? [db.prepare("DELETE FROM member_sessions WHERE google_sub = ?").bind(m.google_sub)] : []),
    // Friends they brought keep their place on old lists, without their names.
    gone("UPDATE registrations SET friend_name = NULL WHERE member_id = ? AND friend_index > 0"),
    // The logs keep what happened; the name in them goes.
    db
      .prepare("UPDATE group_audit SET detail = replace(detail, ?1, ?2) WHERE target_id = ?3 OR actor_id = ?3")
      .bind(was, name, m.id),
    db
      .prepare(
        `UPDATE event_audit SET detail = replace(detail, ?1, ?2) WHERE instr(detail, ?1) > 0
           AND (actor_id = ?3 OR event_id IN (SELECT event_id FROM registrations WHERE member_id = ?3 OR paid_by = ?3))`,
      )
      .bind(was, name, m.id),
    gone("DELETE FROM push_subscriptions WHERE member_id = ?"),
    gone("DELETE FROM push_outbox WHERE member_id = ?"),
    gone("DELETE FROM member_avatars WHERE member_id = ?"),
    gone("DELETE FROM calories WHERE member_id = ?"),
    gone("DELETE FROM calorie_uploads WHERE member_id = ?"),
    gone("DELETE FROM extra_spend WHERE member_id = ?"),
    gone("DELETE FROM likes WHERE from_member = ?1 OR to_member = ?1"),
    // 比分 they recorded or played in go whole: a match without one of its players means nothing.
    gone(
      "DELETE FROM match_players WHERE match_id IN (SELECT match_id FROM match_players WHERE member_id = ?1 UNION SELECT id FROM matches WHERE recorded_by = ?1)",
    ),
    gone(
      "DELETE FROM matches WHERE recorded_by = ?1 OR NOT EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = matches.id)",
    ),
    gone("DELETE FROM queue_accounts WHERE member_id = ?"),
    gone("DELETE FROM queue_credits WHERE member_id = ?"),
    gone("DELETE FROM lottery_watchers WHERE member_id = ?"),
    gone("DELETE FROM lottery_optouts WHERE member_id = ?"),
    gone("DELETE FROM lottery_excluded WHERE member_id = ?"),
    gone("DELETE FROM telegram_langs WHERE chat_id IN (SELECT chat_id FROM telegram_bindings WHERE member_id = ?)"),
    gone("DELETE FROM telegram_bindings WHERE member_id = ?"),
    gone("DELETE FROM payment_aliases WHERE member_id = ?"),
    // A former organizer's row stays for 历史收款人, without the accounts.
    gone(
      "UPDATE payment_profiles SET venmo_username = NULL, venmo_email = NULL, zelle_account = NULL, gmail_confirm = NULL WHERE member_id = ?",
    ),
  ]);
  return !!deleted?.meta.changes;
}

/**
 * Members deleted before 2026-11-18 kept their name, emails and notes. The cron lets go of those
 * too, a few at a time, until none is left (no migration: nothing about the tables changes).
 */
export async function eraseOldDeleted(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM members WHERE deleted_at IS NOT NULL AND username NOT LIKE '已删除成员（%' LIMIT 20",
  ).all<MemberRow>();
  for (const m of results) await eraseMember(env, m, true);
}
