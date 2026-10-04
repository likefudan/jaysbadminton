import { formatDateZh } from "../shared/time";
import type { EventStatus, OrganizersBlock, RevokeImpact } from "../shared/types";
import { SPAM_HINT, type SendResult, sendEmail, site } from "./approvalEmail";
import { now } from "./db";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { ROSTER_EDITABLE } from "./events";
import { type MemberRow, requireMember } from "./members";
import { memberRole, organizersEnabled, ownerId } from "./organizers";
import { payeeUnlockedSql } from "./payees";

/**
 * 任命 / 撤销组织者 and 转交活动 (docs/design/organizers.zh.md §8). Only the ways in are behind the
 * ORGANIZERS flag; revoking as part of 停用 runs whatever the flag says, as it only hands events back.
 */

/** Events that are not archived yet: still taking sign-ups, waiting for Finalize, or collecting. */
const LIVE = `(${ROSTER_EDITABLE.map((s) => `'${s}'`).join(", ")})`;

/** The appoint / revoke / transfer endpoints: refused while the feature is off. */
export function assertOrganizersOn(env: Env): void {
  if (!organizersEnabled(env)) throw new HttpError(403, "forbidden", "组织者功能还没有开放");
}

/** 组织者区块 on the members page: who runs what, and whether their payments can be matched. */
export async function organizersBlock(env: Env, canManage: boolean): Promise<OrganizersBlock | null> {
  if (!organizersEnabled(env)) return null;
  const [{ results: list }, { results: former }] = await Promise.all([
    env.DB.prepare(
      `SELECT m.id, m.username, m.role_since, p.venmo_username, p.venmo_email, p.email_last_at, t.chat_id,
       (SELECT COUNT(*) FROM events e WHERE e.manager_id = m.id AND e.status IN ${LIVE}) AS events
     FROM members m
     LEFT JOIN payment_profiles p ON p.member_id = m.id
     LEFT JOIN telegram_bindings t ON t.member_id = m.id
     WHERE m.role = 'organizer' AND m.is_owner = 0 AND m.status = 'active' AND m.deleted_at IS NULL
     ORDER BY m.role_since, m.id`,
    ).all<{
      id: string;
      username: string;
      role_since: string | null;
      venmo_username: string | null;
      venmo_email: string | null;
      email_last_at: string | null;
      chat_id: string | null;
      events: number;
    }>(),
    // 历史收款人: no longer organizers, but members still pay into their account.
    env.DB.prepare(
      `SELECT m.id, m.username, COUNT(*) AS collecting FROM members m JOIN events e ON e.payee_id = m.id
     WHERE m.is_owner = 0 AND NOT (m.role = 'organizer' AND m.status = 'active' AND m.deleted_at IS NULL)
       AND e.status IN ${LIVE}
     GROUP BY m.id ORDER BY m.id`,
    ).all<{ id: string; username: string; collecting: number }>(),
  ]);
  return {
    canManage,
    list: list.map((o) => ({
      id: o.id,
      username: o.username,
      since: o.role_since,
      paymentReady: !!o.venmo_username && !!o.venmo_email,
      lastVenmoEmailAt: o.email_last_at,
      telegram: !!o.chat_id,
      events: o.events,
    })),
    former,
  };
}

function assertAppointable(m: MemberRow): void {
  if (m.is_owner) throw badRequest("群主本来就有全部权限");
  if (m.status !== "active" || m.deleted_at) throw badRequest("只能任命状态正常的成员");
  if (m.role === "organizer") throw badRequest(`${m.username} 已经是组织者了`);
  // The admin pages open for organizers only through Google, and a member link can't swap in
  // another Google account once one is bound, so the link alone never makes someone an organizer.
  if (!m.google_sub) throw badRequest(`${m.username} 还没有关联 Google 账号。请他先用 Google 登录关联，再任命`);
}

/** Appoints an active member who signs in with Google (only that way reaches the admin pages). */
export async function appointOrganizer(env: Env, id: string): Promise<{ emailStatus: NoticeEmail }> {
  const m = await requireMember(env, id);
  assertAppointable(m);
  const ts = now();
  const done = await env.DB.batch([
    env.DB.prepare(
      `UPDATE members SET role = 'organizer', role_since = ?2
       WHERE id = ?1 AND role != 'organizer' AND status = 'active' AND deleted_at IS NULL AND google_sub IS NOT NULL`,
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
  const emailStatus = await sendEmail(env, {
    to: m.google_email,
    subject: "你已成为羽毛球群的组织者",
    text:
      `${m.username}，你好！\n群主已把你设为组织者：你可以发起活动、管理自己的活动、给自己的活动收款。\n\n` +
      `请用 Google 账号 ${m.google_email} 登录，然后打开管理页：\n${site(env, "/admin/google")}\n\n` +
      "发起活动前，请先在管理页「设置」里填好你的收款设置（Venmo 用户名和 Venmo 通知邮箱）：成员会把钱直接付到你的 Venmo，没填好不能结算。\n" +
      "用专属链接打开网站时仍是普通成员页面，管理功能只在 Google 登录时可用。\n\n" +
      SPAM_HINT,
    key: `organizer-appoint/${m.id}/${ts}`,
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
     WHERE (manager_id = ?1 OR payee_id = ?1) AND status IN ${LIVE} ORDER BY start_at`,
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
  with_: D1PreparedStatement[] = [],
): Promise<{ emailStatus: NoticeEmail } | null> {
  if (m.role !== "organizer") throw badRequest(`${m.username} 不是组织者`);
  const owner = await ownerId(env.DB);
  if (!owner) throw new HttpError(409, "no_owner", "找不到群主的成员记录");
  const ts = now();
  // Each step runs only if this request is the one that revoked them (role_since = ts), so a
  // second click, or a revoke racing this one, changes nothing more.
  const mine = "EXISTS (SELECT 1 FROM members WHERE id = ?2 AND role = 'member' AND role_since = ?3)";
  const done = await env.DB.batch([
    env.DB.prepare("UPDATE members SET role = 'member', role_since = ?2 WHERE id = ?1 AND role = 'organizer'").bind(
      m.id,
      ts,
    ),
    // Before Finalize nobody has a bill, so the money moves with the event.
    env.DB.prepare(
      `UPDATE events SET payee_id = ?1 WHERE payee_id = ?2 AND status IN ('open', 'closed')
         AND ${payeeUnlockedSql("events")} AND ${mine}`,
    ).bind(owner, m.id, ts),
    env.DB.prepare(`UPDATE events SET manager_id = ?1 WHERE manager_id = ?2 AND status IN ${LIVE} AND ${mine}`).bind(
      owner,
      m.id,
      ts,
    ),
    // retired_at marks a 历史收款人 for auto-matching (card 8).
    env.DB.prepare(`UPDATE payment_profiles SET retired_at = ?3 WHERE member_id = ?2 AND ${mine}`).bind(null, m.id, ts),
    // Their Telegram goes (design §8): what is left for them as a 历史收款人 goes to the Owner.
    env.DB.prepare(`DELETE FROM telegram_bindings WHERE member_id = ?2 AND ${mine}`).bind(null, m.id, ts),
    ...with_,
  ]);
  // Someone else revoked them in between: that request did all of this and told them. `with_`
  // (停用) has still happened, so that is not an error; null says there was nothing to revoke.
  if (!done[0]!.meta.changes) {
    if (with_.length) return null;
    throw badRequest(`${m.username} 不是组织者`);
  }
  return { emailStatus: await sendNoticeEmail(env, m, by, ts) };
}

/** They can no longer open the admin pages, so this is how they learn what happens to their events. */
async function sendNoticeEmail(env: Env, m: MemberRow, by: RevokeBy, ts: string): Promise<NoticeEmail> {
  const to = m.google_email ?? m.email;
  if (!to) return "no_address";
  const [venmo, { results: collecting }] = await Promise.all([
    env.DB.prepare("SELECT venmo_username FROM payment_profiles WHERE member_id = ?")
      .bind(m.id)
      .first<{ venmo_username: string | null }>(),
    // Read after the change: exactly the events members still pay into their account.
    env.DB.prepare(`SELECT code, date, title FROM events WHERE payee_id = ? AND status IN ${LIVE} ORDER BY start_at`)
      .bind(m.id)
      .all<{ code: string; date: string; title: string }>(),
  ]);
  const account = venmo?.venmo_username ? `你的 Venmo（@${venmo.venmo_username}）` : "你的账户";
  const lines = [
    `${m.username}，你好！`,
    {
      owner: "群主已撤销你的组织者身份。管理页对你的 Google 账号不再开放；你仍是群里的成员，可以照常报名打球。",
      self: "你已经不再当组织者。管理页对你的 Google 账号不再开放；你仍是群里的成员，可以照常报名打球。",
      deactivate:
        "群主已停用你的账号，你的组织者身份也一并撤销。管理页对你的 Google 账号不再开放；你不能再报名，但还可以打开自己的页面付清欠款。",
    }[by],
    "",
  ];
  if (collecting.length > 0)
    lines.push(
      `下面 ${collecting.length} 场活动已经发出账单，成员还会继续把钱付到${account}，但已经不由你管理。收到钱后请和群主核对：`,
      ...collecting.map((e) => `- ${formatDateZh(e.date)}${e.title ? ` ${e.title}` : ""}（${e.code}）`),
      "",
      "等这几场都收齐后，就可以删掉 Gmail 里转发 Venmo 邮件的过滤器了。",
    );
  else lines.push("你没有还在收款的活动。如果你在 Gmail 里设置过转发 Venmo 邮件的过滤器，现在就可以删掉了。");
  lines.push("", site(env, "/"), "", SPAM_HINT);
  return sendEmail(env, {
    to,
    subject: "你已不再是羽毛球群的组织者",
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
  if (memberRole(env, target) === "member") throw badRequest("只能转给群主或现任组织者");
  // The target is
  // checked again inside the write, in case they stopped being an organizer a moment ago.
  const r = await env.DB.prepare(
    `UPDATE events SET manager_id = ?1,
       payee_id = CASE WHEN status IN ('open', 'closed') AND ${payeeUnlockedSql("events")}
                       THEN ?1 ELSE payee_id END
     WHERE id = ?2 AND status IN ${LIVE}
       AND EXISTS (SELECT 1 FROM members WHERE id = ?1 AND deleted_at IS NULL
                     AND (is_owner = 1 OR (role = 'organizer' AND status = 'active')))`,
  )
    .bind(target.id, eventId)
    .run();
  if (r.meta.changes) return;
  if (memberRole(env, await requireMember(env, to)) === "member") throw badRequest("只能转给群主或现任组织者");
  throw badRequest("已收齐归档或已取消的活动不能转交");
}

/** A new event by someone revoked a moment ago goes to the Owner, as revoking did with their others. */
export async function handBackIfRevoked(env: Env, eventId: number, creator: string | null): Promise<void> {
  await env.DB.prepare(
    `UPDATE events SET manager_id = ?3, payee_id = ?3
     WHERE id = ?1 AND manager_id = ?2
       AND NOT EXISTS (SELECT 1 FROM members WHERE id = ?2 AND role = 'organizer' AND status = 'active')`,
  )
    .bind(eventId, creator, await ownerId(env.DB))
    .run();
}

/**
 * 删除成员: someone still running an event, or paid for one (a 历史收款人), stays until it is
 * archived. Never the Owner (they can't be deleted), so NULL (the Owner) needn't be resolved.
 */
export async function assertNotRunning(env: Env, m: MemberRow): Promise<void> {
  const e = await env.DB.prepare(
    `SELECT e.date, e.payee_id = ?1 AS paid FROM events e
     WHERE (e.payee_id = ?1 OR e.manager_id = ?1) AND e.status IN ${LIVE} ORDER BY e.start_at LIMIT 1`,
  )
    .bind(m.id)
    .first<{ date: string; paid: number }>();
  if (e)
    throw badRequest(
      `${m.username} 是 ${e.date} 活动的${e.paid ? "收款人" : "负责人"}，这场还没收齐归档。请等这场收齐归档${e.paid ? "" : "（或把它转交给别人）"}后再删除成员`,
    );
}
