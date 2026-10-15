import { formatDateZh } from "../shared/time";
import type { EventStatus, OrganizersBlock, RevokeImpact } from "../shared/types";
import { SPAM_HINT, type SendResult, sendEmail, site } from "./approvalEmail";
import { now } from "./db";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { LIVE_SQL } from "./events";
import { type MemberRow, requireMember } from "./members";
import {
  ROLE_TITLE,
  STAFF_SQL,
  type StaffRole,
  currentStaffSql,
  isStaff,
  memberRole,
  organizersEnabled,
  ownerId,
  payeeProfile,
} from "./organizers";
import { once } from "./notify";
import { ownerName, payeeExpired, payeeName, payeeUnlockedSql } from "./payees";
import { SYSTEM, audit } from "./audit";
import { quietBills } from "./health";

/**
 * 任命 / 撤销组织者 and 转交活动 (docs/design/organizers.zh.md §8). Only the ways in are behind the
 * ORGANIZERS flag; revoking as part of 停用 runs whatever the flag says, as it only hands events back.
 */

/** The appoint / revoke / transfer endpoints: refused while the feature is off. */
export function assertOrganizersOn(env: Env): void {
  if (!organizersEnabled(env)) throw new HttpError(403, "forbidden", "组织者功能还没有开放");
}

/** 组织者区块 on the members page: who runs what, and whether their payments can be matched. */
export async function organizersBlock(env: Env, canManage: boolean): Promise<OrganizersBlock | null> {
  if (!organizersEnabled(env)) return null;
  const [{ results: list }, { results: former }] = await Promise.all([
    env.DB.prepare(
      `SELECT m.id, m.username, m.role, m.role_since, p.venmo_username, p.venmo_email, p.email_last_at, t.chat_id,
       (SELECT COUNT(*) FROM events e WHERE e.manager_id = m.id AND e.status IN ${LIVE_SQL}) AS events
     FROM members m
     LEFT JOIN payment_profiles p ON p.member_id = m.id
     LEFT JOIN telegram_bindings t ON t.member_id = m.id
     WHERE ${currentStaffSql("m")}
     ORDER BY m.role_since, m.id`,
    ).all<{
      id: string;
      username: string;
      role: StaffRole;
      role_since: string | null;
      venmo_username: string | null;
      venmo_email: string | null;
      email_last_at: string | null;
      chat_id: string | null;
      events: number;
    }>(),
    // 历史收款人: no longer organizers or admins, but members still pay into their account.
    env.DB.prepare(
      `SELECT m.id, m.username, COUNT(*) AS collecting FROM members m JOIN events e ON e.payee_id = m.id
     WHERE m.is_owner = 0 AND NOT (${currentStaffSql("m")})
       AND e.status IN ${LIVE_SQL}
     GROUP BY m.id ORDER BY m.id`,
    ).all<{ id: string; username: string; collecting: number }>(),
  ]);
  return {
    canManage,
    list: await Promise.all(
      list.map(async (o) => ({
        id: o.id,
        username: o.username,
        role: o.role,
        since: o.role_since,
        paymentReady: !!o.venmo_username && !!o.venmo_email,
        lastVenmoEmailAt: o.email_last_at,
        quietBills: o.venmo_username ? await quietBills(env, o.id, o.email_last_at) : 0,
        telegram: !!o.chat_id,
        events: o.events,
      })),
    ),
    former,
  };
}

/** Whether `m` may be made `role`: an organizer from a member, an admin from a member or organizer. */
function assertAppointable(m: MemberRow, role: StaffRole = "organizer"): void {
  if (m.is_owner) throw badRequest("群主本来就有全部权限");
  if (m.status !== "active" || m.deleted_at) throw badRequest("只能任命状态正常的成员");
  if (isStaff(m.role) && (m.role === role || role === "organizer"))
    throw badRequest(`${m.username} 已经是${ROLE_TITLE[m.role]}了`);
  // The admin pages open for organizers only through Google, and a member link can't swap in
  // another Google account once one is bound, so the link alone never makes someone an organizer.
  if (!m.google_sub) throw badRequest(`${m.username} 还没有关联 Google 账号。请他先用 Google 登录关联，再任命`);
}

/**
 * Appoints an active member who signs in with Google (only that way reaches the admin pages).
 * `by` is who did it (the Owner or an admin), named in the email.
 */
export async function appointOrganizer(
  env: Env,
  id: string,
  by: string | null = null,
): Promise<{ emailStatus: NoticeEmail }> {
  const m = await requireMember(env, id);
  assertAppointable(m);
  const ts = now();
  const done = await env.DB.batch([
    env.DB.prepare(
      `UPDATE members SET role = 'organizer', role_since = ?2
       WHERE id = ?1 AND role NOT IN ${STAFF_SQL} AND status = 'active' AND deleted_at IS NULL AND google_sub IS NOT NULL`,
    ).bind(m.id, ts),
    // Someone appointed before keeps their payment settings and is no longer a 历史收款人 (only if
    // the line above appointed them).
    env.DB.prepare(
      `UPDATE payment_profiles SET retired_at = NULL WHERE member_id = ?1
         AND EXISTS (SELECT 1 FROM members WHERE id = ?1 AND role = 'organizer' AND role_since = ?2)`,
    ).bind(m.id, ts),
  ]);
  if (!done[0]!.meta.changes) {
    // Something changed in between (appointed, disabled, Google unlinked): say what.
    assertAppointable(await requireMember(env, id));
    throw badRequest("刚才有别的操作改了他的状态，请刷新页面后再试");
  }
  if (!m.google_email) return { emailStatus: "no_address" };
  const who = await payeeName(env.DB, by);
  const emailStatus = await sendEmail(env, {
    to: m.google_email,
    subject: "你已成为羽毛球群的组织者",
    text:
      `${m.username}，你好！\n${who} 已把你设为组织者：你可以发起活动、管理自己的活动、给自己的活动收款。\n\n` +
      `请用 Google 账号 ${m.google_email} 登录，然后打开管理页：\n${site(env, "/admin/google")}\n\n` +
      "发起活动前，请先在管理页「设置」里填好你的收款设置（Venmo 用户名和 Venmo 通知邮箱）：成员会把钱直接付到你的 Venmo，没填好不能结算。\n" +
      "用专属链接打开网站时仍是普通成员页面，管理功能只在 Google 登录时可用。\n\n" +
      SPAM_HINT,
    key: `organizer-appoint/${m.id}/${ts}`,
  });
  return { emailStatus };
}

/**
 * 设为管理员 / 升为管理员 (Owner only, admin-role.zh.md §8): a member signing in with Google, or a
 * current organizer, who keeps their events, payment settings and Telegram. Admins run the whole
 * group except the Owner's own powers.
 */
export async function appointAdmin(
  env: Env,
  id: string,
): Promise<{ emailStatus: NoticeEmail; from: "member" | "organizer" }> {
  const m = await requireMember(env, id);
  assertAppointable(m, "admin");
  const from = m.role === "organizer" ? "organizer" : "member";
  const ts = now();
  const done = await env.DB.batch([
    // Only from the role read, so a revoke or appointment landing in between is not overwritten.
    env.DB.prepare(
      `UPDATE members SET role = 'admin', role_since = ?2
       WHERE id = ?1 AND role = ?3 AND status = 'active' AND deleted_at IS NULL AND google_sub IS NOT NULL`,
    ).bind(m.id, ts, m.role),
    // Someone who collected before keeps their payment settings and is no longer a 历史收款人.
    env.DB.prepare(
      `UPDATE payment_profiles SET retired_at = NULL WHERE member_id = ?1
         AND EXISTS (SELECT 1 FROM members WHERE id = ?1 AND role = 'admin' AND role_since = ?2)`,
    ).bind(m.id, ts),
  ]);
  if (!done[0]!.meta.changes) {
    assertAppointable(await requireMember(env, id), "admin");
    throw badRequest("刚才有别的操作改了他的状态，请刷新页面后再试");
  }
  const to = m.google_email ?? m.email;
  if (!to) return { emailStatus: "no_address", from };
  const owner = await ownerName(env.DB);
  const emailStatus = await sendEmail(env, {
    to,
    subject: "你已成为羽毛球群的管理员",
    text:
      `${m.username}，你好！\n${owner} 已把你设为管理员：除了几项只有 ${owner} 能做的事（任命管理员、清空数据、密钥和备份、永久删除），` +
      "你可以像群主一样管理整个群：审核和管理成员、任命组织者、管理所有活动和付款、修改全局设置、导出数据。\n\n" +
      `请用你的 Google 账号${m.google_email ? ` ${m.google_email} ` : ""}登录，然后打开管理页：\n${site(env, "/admin/google")}\n\n` +
      (from === "organizer"
        ? "你原来的活动、收款设置和 Telegram 都保留不变。\n"
        : "你自己发起活动前，请先在管理页「设置」里填好你的收款设置（Venmo 用户名和 Venmo 通知邮箱）：你发起的活动，成员会把钱直接付到你的 Venmo。\n") +
      "用专属链接打开网站时仍是普通成员页面，管理功能只在 Google 登录时可用。\n\n" +
      SPAM_HINT,
    key: `admin-appoint/${m.id}/${ts}`,
  });
  return { emailStatus, from };
}

/**
 * 降为组织者 (Owner only): an admin keeps their events, payment settings and Telegram, and runs
 * only their own events from now on.
 */
export async function demoteAdmin(env: Env, id: string): Promise<{ emailStatus: NoticeEmail }> {
  const m = await requireMember(env, id);
  if (m.role !== "admin") throw badRequest(`${m.username} 不是管理员`);
  // Disabled by older code (still an admin): 恢复 revokes them first, as for organizers.
  if (m.status !== "active" || m.deleted_at) throw badRequest("请先「恢复」这个成员（会撤销管理员身份）");
  const ts = now();
  const r = await env.DB.prepare(
    `UPDATE members SET role = 'organizer', role_since = ?2
     WHERE id = ?1 AND role = 'admin' AND status = 'active' AND deleted_at IS NULL`,
  )
    .bind(m.id, ts)
    .run();
  if (!r.meta.changes) throw badRequest("刚才有别的操作改了他的状态，请刷新页面后再试");
  const to = m.google_email ?? m.email;
  if (!to) return { emailStatus: "no_address" };
  const owner = await ownerName(env.DB);
  // Organizers settle their own events only with their payment settings filled in.
  const ready = await payeeProfile(env.DB, m.id);
  const emailStatus = await sendEmail(env, {
    to,
    subject: "你在羽毛球群的身份改为组织者",
    text:
      `${m.username}，你好！\n${owner} 已把你从管理员改为组织者：你仍然可以发起活动、管理自己的活动、给自己的活动收款，` +
      "但不再管理成员、别人的活动和全站设置。你的活动、收款设置和 Telegram 都保留不变。\n" +
      (ready
        ? ""
        : "你还没有填收款设置：请在管理页「设置」里填好 Venmo 用户名和 Venmo 通知邮箱，否则不能结算自己的活动。\n") +
      "\n" +
      `${site(env, "/admin/google")}\n\n${SPAM_HINT}`,
    key: `admin-demote/${m.id}/${ts}`,
  });
  return { emailStatus };
}

interface ImpactRow {
  id: number;
  code: string;
  date: string;
  title: string;
  status: EventStatus;
  manager_id: string | null;
  payee_id: string | null;
  /** No Finalize and no bills yet: the payee can still move (assertPayeeUnlocked). */
  unlocked: number;
}

/** The same rules as the writes in revokeOrganizer, for one event. */
function outcome(e: ImpactRow, id: string): RevokeImpact["outcome"] {
  const runs = e.manager_id === id;
  const paid = e.payee_id === id;
  // Before Finalize nobody has a bill yet, so the money goes back with the event.
  if (e.status !== "finalized" && e.unlocked)
    return runs && paid ? "to_owner" : runs ? "manager_only" : "payee_to_owner";
  // After it, members are already paying into their account: only who runs it changes, if it is them.
  if (!paid) return "manager_only";
  return runs ? "payee_stays" : "payee_only";
}

/** What revoking someone does to each of their events that is not archived (design §8 table). */
export async function revokeImpact(env: Env, id: string): Promise<RevokeImpact[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, code, date, title, status, manager_id, payee_id, ${payeeUnlockedSql("events")} AS unlocked FROM events
     WHERE (manager_id = ?1 OR payee_id = ?1) AND status IN ${LIVE_SQL} ORDER BY start_at`,
  )
    .bind(id)
    .all<ImpactRow>();
  return results.map((e) => ({
    id: e.id,
    code: e.code,
    date: e.date,
    title: e.title,
    status: e.status,
    outcome: outcome(e, id),
  }));
}

export type RevokeBy = "owner" | "self" | "deactivate";
/** What happened to an appointment or revoke email; no_address: they have no email to send it to. */
export type NoticeEmail = SendResult | "no_address";

/**
 * 撤销组织者 (by the Owner, by themselves 不再当组织者, or as part of 停用): their events go back to
 * the Owner, except that finalized events keep paying into their account until archived. Their
 * payment settings stay (retired) so those payments can still be matched, and they are told by
 * email. `with` runs in the same transaction (停用's own statements), so it all happens or none.
 */
export async function revokeOrganizer(
  env: Env,
  m: MemberRow,
  by: RevokeBy,
  opts: {
    /** Statements run in the same transaction (停用's own), after the role is taken away. */
    with?: D1PreparedStatement[];
    /** Receives the results of `with`, once the transaction has run. */
    withResults?: (r: D1Result[]) => void;
    /** Who revoked them, for 操作记录 and the email: the Owner when not given. Ignored for "self". */
    actor?: string | null;
  } = {},
): Promise<{ emailStatus: NoticeEmail } | null> {
  const { with: with_ = [], withResults = () => {}, actor = null } = opts;
  if (!isStaff(m.role)) throw badRequest(`${m.username} 不是组织者或管理员`);
  const title = ROLE_TITLE[m.role];
  const owner = await ownerId(env.DB);
  if (!owner) throw new HttpError(409, "no_owner", "找不到群主的成员记录");
  const ts = now();
  // Each step runs only if this request is the one that revoked them (role_since = ts), so a
  // second click, or a revoke racing this one, changes nothing more.
  const mine = "EXISTS (SELECT 1 FROM members WHERE id = ?2 AND role = 'member' AND role_since = ?3)";
  const done = await env.DB.batch([
    // Only the role that was read: someone made an admin meanwhile is not revoked by a request that
    // was let through for an organizer (only the Owner may revoke an admin).
    env.DB.prepare("UPDATE members SET role = 'member', role_since = ?2 WHERE id = ?1 AND role = ?3").bind(
      m.id,
      ts,
      m.role,
    ),
    // Before Finalize nobody has a bill, so the money moves with the event. Both return the events
    // they moved, for 操作记录.
    env.DB.prepare(
      `UPDATE events SET payee_id = ?1 WHERE payee_id = ?2 AND status IN ('open', 'closed')
         AND ${payeeUnlockedSql("events")} AND ${mine} RETURNING id`,
    ).bind(owner, m.id, ts),
    env.DB.prepare(
      `UPDATE events SET manager_id = ?1 WHERE manager_id = ?2 AND status IN ${LIVE_SQL} AND ${mine}
       RETURNING id, payee_id`,
    ).bind(owner, m.id, ts),
    // retired_at marks a 历史收款人 for auto-matching (card 8).
    env.DB.prepare(`UPDATE payment_profiles SET retired_at = ?3 WHERE member_id = ?2 AND ${mine}`).bind(null, m.id, ts),
    // Their Telegram goes (design §8): what is left for them as a 历史收款人 goes to the Owner.
    env.DB.prepare(`DELETE FROM telegram_bindings WHERE member_id = ?2 AND ${mine}`).bind(null, m.id, ts),
    ...with_,
  ]);
  withResults(done.slice(done.length - with_.length));
  // Someone else revoked them in between (that request did all of this and told them), or their
  // role changed: null says there was nothing to revoke; the caller checks what `with_` did.
  if (!done[0]!.meta.changes) {
    if (with_.length) return null;
    throw badRequest(`${m.username} 不是${title}`);
  }
  const doer = by === "self" ? m.id : (actor ?? owner);
  await recordHandBack(env, m, by, doer, done[1]!, done[2]!, title);
  // Nothing of theirs still collects: the notice email says the filter can go, so the 失效
  // reminder (remindIfExpired) counts as sent. Claimed first so the sweep can't send one meanwhile,
  // and given back if the notice didn't go out, so the sweep sends the reminder later.
  const claim = env.DB.prepare(
    "INSERT OR IGNORE INTO notification_log (event_id, type, sent_on, sent_at) VALUES (0, ?1, ?2, ?2)",
  ).bind(filterReminder(m.id), ts);
  const claimed = (await payeeExpired(env.DB, m.id)) && !!(await claim.run()).meta.changes;
  const emailStatus = await sendNoticeEmail(env, m, by, ts, title, doer);
  if (claimed && emailStatus !== "sent")
    await env.DB.prepare("DELETE FROM notification_log WHERE event_id = 0 AND type = ? AND sent_on = ?")
      .bind(filterReminder(m.id), ts)
      .run();
  return { emailStatus };
}

/**
 * 操作记录 for a revoke: each event that went back to the Owner, by whoever revoked (the organizer
 * themselves for 不再当组织者), and each one where only the money moved.
 */
async function recordHandBack(
  env: Env,
  m: MemberRow,
  by: RevokeBy,
  actor: string,
  payees: D1Result,
  managers: D1Result,
  title: string,
): Promise<void> {
  const who = {
    owner: `撤销 ${m.username} 的${title}身份`,
    self: `${m.username} 不再当${title}`,
    deactivate: `停用 ${m.username}，${title}身份一并撤销`,
  }[by];
  const handed = managers.results as { id: number; payee_id: string | null }[];
  const owner = await ownerName(env.DB);
  for (const e of handed)
    await audit(
      env,
      e.id,
      actor,
      "reassign",
      // Bills are out: members keep paying into their account until it is archived.
      `${who}，活动交回 ${owner}${e.payee_id === m.id ? `（账单已发出，钱仍付到 ${m.username} 的账户）` : ""}`,
    );
  for (const e of payees.results as { id: number }[])
    if (!handed.some((h) => h.id === e.id)) await audit(env, e.id, actor, "reassign", `${who}，收款人改为 ${owner}`);
}

/** They can no longer open the admin pages, so this is how they learn what happens to their events. */
async function sendNoticeEmail(
  env: Env,
  m: MemberRow,
  by: RevokeBy,
  ts: string,
  title: string,
  /** Who revoked or disabled them (member id), named in the email. */
  doerId: string,
): Promise<NoticeEmail> {
  const to = m.google_email ?? m.email;
  if (!to) return "no_address";
  const doer = by === "self" ? "" : await payeeName(env.DB, doerId);
  const [venmo, { results: collecting }] = await Promise.all([
    env.DB.prepare("SELECT venmo_username FROM payment_profiles WHERE member_id = ?")
      .bind(m.id)
      .first<{ venmo_username: string | null }>(),
    // Read after the change: exactly the events members still pay into their account.
    env.DB.prepare(
      `SELECT code, date, title FROM events WHERE payee_id = ? AND status IN ${LIVE_SQL} ORDER BY start_at`,
    )
      .bind(m.id)
      .all<{ code: string; date: string; title: string }>(),
  ]);
  const owner = await ownerName(env.DB);
  const account = venmo?.venmo_username ? `你的 Venmo（@${venmo.venmo_username}）` : "你的账户";
  const lines = [
    `${m.username}，你好！`,
    {
      owner: `${doer} 已撤销你的${title}身份。管理页对你的 Google 账号不再开放；你仍是群里的成员，可以照常报名打球。`,
      self: `你已经不再当${title}。管理页对你的 Google 账号不再开放；你仍是群里的成员，可以照常报名打球。`,
      deactivate: `${doer} 已停用你的账号，你的${title}身份也一并撤销。管理页对你的 Google 账号不再开放；你不能再报名，但还可以打开自己的页面付清欠款。`,
    }[by],
    "",
  ];
  if (collecting.length > 0)
    lines.push(
      `下面 ${collecting.length} 场活动已经发出账单，成员还会继续把钱付到${account}，但已经不由你管理。收到钱后请和 ${owner} 核对：`,
      ...collecting.map((e) => `- ${formatDateZh(e.date)}${e.title ? ` ${e.title}` : ""}（${e.code}）`),
      "",
      "等这几场都收齐后，就可以删掉 Gmail 里转发 Venmo 邮件的过滤器了。",
    );
  else lines.push("你没有还在收款的活动。如果你在 Gmail 里设置过转发 Venmo 邮件的过滤器，现在就可以删掉了。");
  lines.push("", site(env, "/"), "", SPAM_HINT);
  return sendEmail(env, {
    to,
    subject: `你已不再是羽毛球群的${title}`,
    text: lines.join("\n"),
    key: `organizer-revoke/${m.id}/${ts}`,
  });
}

/**
 * 转交 (Owner): another organizer or the Owner runs the event from now on. Before Finalize the
 * money goes with it; once bills exist the payee stays, as members may already have paid.
 */
export async function transferEvent(env: Env, eventId: number, to: string): Promise<void> {
  const target = await requireMember(env, to);
  if (memberRole(env, target) === "member") throw badRequest("只能转给群主、管理员或现任组织者");
  // The target is
  // checked again inside the write, in case they stopped being an organizer a moment ago.
  const r = await env.DB.prepare(
    `UPDATE events SET manager_id = ?1,
       payee_id = CASE WHEN status IN ('open', 'closed') AND ${payeeUnlockedSql("events")}
                       THEN ?1 ELSE payee_id END
     WHERE id = ?2 AND status IN ${LIVE_SQL}
       AND EXISTS (SELECT 1 FROM members WHERE id = ?1 AND deleted_at IS NULL
                     AND (is_owner = 1 OR (${currentStaffSql("members")})))`,
  )
    .bind(target.id, eventId)
    .run();
  if (r.meta.changes) return;
  if (memberRole(env, await requireMember(env, to)) === "member") throw badRequest("只能转给群主、管理员或现任组织者");
  throw badRequest("已收齐归档或已取消的活动不能转交");
}

/** A new event by someone revoked a moment ago goes to the Owner, as revoking did with their others. */
export async function handBackIfRevoked(env: Env, eventId: number, creator: string | null): Promise<void> {
  const r = await env.DB.prepare(
    `UPDATE events SET manager_id = ?3, payee_id = ?3
     WHERE id = ?1 AND manager_id = ?2
       AND NOT EXISTS (SELECT 1 FROM members WHERE id = ?2 AND ${currentStaffSql("members")})`,
  )
    .bind(eventId, creator, await ownerId(env.DB))
    .run();
  if (r.meta.changes)
    await audit(
      env,
      eventId,
      SYSTEM,
      "reassign",
      `创建者刚被撤销组织者或管理员身份，活动交给 ${await ownerName(env.DB)}`,
    );
}

/**
 * 删除成员: someone still running an event, or paid for one (a 历史收款人), stays until it is
 * archived. Never the Owner (they can't be deleted), so NULL (the Owner) needn't be resolved.
 */
export async function assertNotRunning(env: Env, m: MemberRow): Promise<void> {
  const e = await env.DB.prepare(
    `SELECT e.date, e.payee_id = ?1 AS paid FROM events e
     WHERE (e.payee_id = ?1 OR e.manager_id = ?1) AND e.status IN ${LIVE_SQL} ORDER BY e.start_at LIMIT 1`,
  )
    .bind(m.id)
    .first<{ date: string; paid: number }>();
  if (e)
    throw badRequest(
      `${m.username} 是 ${e.date} 活动的${e.paid ? "收款人" : "负责人"}，这场还没收齐归档。请等这场收齐归档${e.paid ? "" : "（或把它转交给别人）"}后再删除成员`,
    );
}

/** notification_log type of the 失效 reminder; keyed by retired_at, so each revocation gets one. */
const filterReminder = (id: string) => `filter_reminder:${id}`;

/**
 * The sweep behind remindIfExpired, on every scheduled run: every former organizer whose account has expired and
 * who hasn't been told yet, whatever took their last event out of collection, including a reminder
 * that could not be sent at the time.
 */
export async function remindExpiredPayees(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT p.member_id FROM payment_profiles p WHERE p.retired_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM events WHERE payee_id = p.member_id AND status IN ${LIVE_SQL})
       AND NOT EXISTS (SELECT 1 FROM notification_log WHERE event_id = 0
                         AND type = 'filter_reminder:' || p.member_id AND sent_on = p.retired_at)`,
  ).all<{ member_id: string }>();
  for (const r of results) await remindIfExpired(env, r.member_id);
}

/**
 * 失效 (design §8): once the last event paying into a former organizer's account is archived,
 * cancelled or deleted, nothing more is matched there, so they are told by email that they can
 * remove their Gmail forwarding filter. Once per revocation: someone revoked with nothing still
 * collecting expired right then, and the revoke email already said so (revokeOrganizer marks it);
 * a reminder that could not be sent is tried again by the scheduled sweep (remindExpiredPayees).
 */
export async function remindIfExpired(env: Env, payeeId: string | null): Promise<void> {
  if (!payeeId || !(await payeeExpired(env.DB, payeeId))) return;
  const m = await env.DB.prepare(
    `SELECT m.username, m.google_email, m.email, p.retired_at, p.venmo_username
     FROM members m JOIN payment_profiles p ON p.member_id = m.id WHERE m.id = ?`,
  )
    .bind(payeeId)
    .first<{
      username: string;
      google_email: string | null;
      email: string | null;
      retired_at: string;
      venmo_username: string | null;
    }>();
  const to = m?.google_email ?? m?.email;
  if (!m || !to) return;
  const account = m.venmo_username ? `你的 Venmo（@${m.venmo_username}）` : "你的账户";
  await once(env, 0, filterReminder(payeeId), m.retired_at, async () => {
    const sent = await sendEmail(env, {
      to,
      subject: "可以删掉转发 Venmo 邮件的过滤器了",
      text: [
        `${m.username}，你好！`,
        `你当组织者时收款的活动都已经收齐、取消或删除，羽毛球群不会再把钱记到${account}。`,
        "如果你在 Gmail 里设置过把 Venmo 邮件转发给羽毛球群的过滤器，现在可以删掉了。",
        "",
        site(env, "/"),
        "",
        SPAM_HINT,
      ].join("\n"),
      key: `organizer-expired/${payeeId}/${m.retired_at}`,
    });
    return sent === "sent";
  });
}
