import { endDeveloperSession } from "../developer";
import { sendApprovalEmail } from "../approvalEmail";
import { type Context, Hono } from "hono";
import { checkPassword as checkPasswordRule } from "../../shared/rules";
import type { ApproveResponse, LinkResponse, MemberProfile, MembersResponse } from "../../shared/types";
import { type AdminEnv, adminAccess, assertMayActOn } from "../access";
import { ROLE_CAPABILITIES, ROLE_TITLE, STAFF_SQL, can, isStaff, memberRole, ownerId } from "../organizers";
import {
  appointAdmin,
  appointOrganizer,
  assertNotRunning,
  assertOrganizersOn,
  demoteAdmin,
  organizersBlock,
  revokeImpact,
  revokeOrganizer,
} from "../appointments";
import { checkPassword, endSession, issueAdminToken, setPassword, startSession } from "../auth";
import { now } from "../db";
import { closeExpired } from "../events";
import { actorId, audit, groupAudit, groupAuditRows } from "../audit";
import type { Env } from "../env";
import { HttpError, badRequest, readJson, str } from "../http";
import { adminEventRoutes } from "./adminEvents";
import {
  type MemberRow,
  emailTaken,
  forgetPush,
  issueMemberToken,
  memberLink,
  requireMember,
  revealMemberToken,
  toSummary,
} from "../members";
import { memberProfile, setAdminNote } from "../profile";
import { googleSession, memberByGoogle, requireSameOrigin } from "../googleAuth";
import { isStaging } from "../site";
import { escapeHtml, saveBotToken, sendToOwner } from "../telegram";
import { bt } from "../botLang";

export const adminRoutes = new Hono<AdminEnv>();

// Who is calling and whether they may: one table for every endpoint (access.ts).
adminRoutes.use("/:token/*", adminAccess);

adminRoutes.post("/:token/login", async (c) => {
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");
  await startSession(c);
  return c.json({ ok: true });
});

adminRoutes.post("/:token/logout", async (c) => {
  if (c.req.param("token") === "developer") await endDeveloperSession(c);
  await endSession(c);
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM members ORDER BY id").all<MemberRow>();
  // 未付 counts only the events one runs, without `group`: other people's fees stay theirs.
  const actor = c.get("actor");
  const [owing, organizers] = await Promise.all([
    owingByMember(c.env, can(actor.role, "group") ? null : actor.memberId),
    organizersBlock(c.env, can(actor.role, "group")),
  ]);
  const all = results.map((m) => {
    const role = memberRole(c.env, m);
    return {
      ...toSummary(m),
      owingCents: owing.get(m.id) ?? 0,
      isOrganizer: role === "organizer",
      isAdmin: role === "admin",
    };
  });
  return c.json<MembersResponse>({
    pending: all.filter((m) => m.status === "pending"),
    active: all.filter((m) => m.status === "active"),
    inactive: all.filter((m) => m.status === "inactive" && !m.deletedAt),
    deleted: all.filter((m) => !!m.deletedAt),
    organizers,
    viewer: { id: actor.memberId, role: actor.role, caps: [...ROLE_CAPABILITIES[actor.role]] },
  });
});

/** 群操作记录, a page at a time (the Owner and admins). */
adminRoutes.get("/:token/group-audit", async (c) => {
  const before = Number(c.req.query("before"));
  return c.json(await groupAuditRows(c.env, Number.isInteger(before) && before > 0 ? before : null));
});

/** 设为组织者 (design §8). */
adminRoutes.post("/:token/members/:id/appoint", async (c) => {
  assertOrganizersOn(c.env);
  const res = await appointOrganizer(c.env, c.req.param("id"), c.get("actor").memberId);
  const m = await requireMember(c.env, c.req.param("id"));
  await groupAudit(c.env, c.get("actor"), "appoint", m.id, `任命 ${m.username} 为组织者`);
  return c.json(res);
});

/** 设为管理员 / 升为管理员 (admin-role.zh.md §8; Owner only). */
adminRoutes.post("/:token/members/:id/appoint-admin", async (c) => {
  assertOrganizersOn(c.env);
  const before = await requireMember(c.env, c.req.param("id"));
  const res = await appointAdmin(c.env, before.id);
  const how =
    before.role === "organizer" ? `把 ${before.username} 从组织者升为管理员` : `任命 ${before.username} 为管理员`;
  await groupAudit(c.env, c.get("actor"), "appoint_admin", before.id, how);
  return c.json(res);
});

/** 降为组织者 (Owner only): keeps their events. */
adminRoutes.post("/:token/members/:id/demote-admin", async (c) => {
  assertOrganizersOn(c.env);
  const res = await demoteAdmin(c.env, c.req.param("id"));
  const m = await requireMember(c.env, c.req.param("id"));
  await groupAudit(c.env, c.get("actor"), "demote_admin", m.id, `把 ${m.username} 从管理员降为组织者`);
  return c.json(res);
});

/** What 撤销组织者 / 撤销管理员 would do, for the confirmation. */
adminRoutes.get("/:token/members/:id/revoke", async (c) => {
  assertOrganizersOn(c.env);
  const m = await target(c);
  if (!isStaff(m.role)) throw badRequest(`${m.username} 不是组织者或管理员`);
  return c.json({ events: await revokeImpact(c.env, m.id) });
});

adminRoutes.post("/:token/members/:id/revoke", async (c) => {
  assertOrganizersOn(c.env);
  const m = await target(c);
  // Disabled ones (by older code) are revoked by 恢复, with the right email.
  if (m.status !== "active") throw badRequest("请先「恢复」这个成员（会撤销组织者身份）");
  const res = await revokeOrganizer(c.env, m, "owner", { actor: c.get("actor").memberId });
  await groupAudit(
    c.env,
    c.get("actor"),
    "revoke",
    m.id,
    `撤销 ${m.username} 的${ROLE_TITLE[m.role as "admin"] ?? "组织者"}身份`,
  );
  return c.json(res);
});

/** 不再当组织者 / 不再当管理员: one steps down; the same rules as being revoked. */
adminRoutes.get("/:token/organizer/retire", async (c) => {
  const actor = c.get("actor");
  if (!isStaff(actor.role) || !actor.memberId) throw badRequest("只有组织者或管理员可以这样做");
  return c.json({ events: await revokeImpact(c.env, actor.memberId) });
});

adminRoutes.post("/:token/organizer/retire", async (c) => {
  const actor = c.get("actor");
  if (!isStaff(actor.role) || !actor.memberId) throw badRequest("只有组织者或管理员可以这样做");
  const m = await requireMember(c.env, actor.memberId);
  const res = await revokeOrganizer(c.env, m, "self");
  await groupAudit(c.env, actor, "retire", m.id, `${m.username} 不再当${ROLE_TITLE[actor.role]}`);
  return c.json(res);
});

const origin = (url: string) => new URL(url).origin;

/**
 * The member in the path, read again in the handler: someone made an admin after access.ts let the
 * request through (memberTarget) is still the Owner's alone.
 */
async function target(c: Context<AdminEnv>): Promise<MemberRow> {
  const m = await requireMember(c.env, c.req.param("id") ?? "");
  assertMayActOn(c.get("actor"), m);
  return m;
}

adminRoutes.post("/:token/members/:id/approve", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "pending") throw badRequest("这个申请已经处理过了");
  const updated = await c.env.DB.prepare(
    "UPDATE members SET status = 'active', approved_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(now(), m.id)
    .run();
  if (!updated.meta.changes) throw badRequest("这个申请已经处理过了");
  await groupAudit(c.env, c.get("actor"), "approve", m.id, `通过 ${m.username} 的入群申请`);
  // Applied with Google: they sign in with it, so there is no link to send (a spare one can still
  // be made from the members list).
  if (m.google_sub)
    return c.json<ApproveResponse>({
      link: null,
      googleEmail: m.google_email,
      emailStatus: await sendApprovalEmail(c.env, m.id),
    });
  const token = await issueMemberToken(c.env, m.id);
  // Registered with email: the link goes out by email right away (the admin can still copy it).
  const emailStatus = m.email ? await sendApprovalEmail(c.env, m.id) : undefined;
  return c.json<ApproveResponse>({
    link: memberLink(origin(c.req.url), token),
    googleEmail: null,
    email: m.email,
    emailStatus,
  });
});

adminRoutes.post("/:token/members/:id/approval-email", async (c) => {
  const m = await target(c);
  if (!(m.google_sub || m.email) || m.status !== "active" || m.deleted_at || !m.approved_at)
    throw badRequest("只能向已通过审核、留了邮箱的成员发送通知");
  return c.json({ emailStatus: await sendApprovalEmail(c.env, m.id) });
});

adminRoutes.post("/:token/members/:id/reject", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "pending") throw badRequest("只能拒绝待审核的申请");
  const gone = await c.env.DB.prepare("DELETE FROM members WHERE id = ? AND status = 'pending'").bind(m.id).run();
  if (gone.meta.changes) await groupAudit(c.env, c.get("actor"), "reject", m.id, `拒绝 ${m.username} 的入群申请`);
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members/:id/profile", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  return c.json<MemberProfile>({ ...(await memberProfile(c.env, m)), adminNote: m.admin_note ?? "" });
});

adminRoutes.post("/:token/members/:id/note", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  const note = str((await readJson(c.req.raw)).note).trim();
  await setAdminNote(c.env, m, note);
  if (note !== (m.admin_note ?? ""))
    await groupAudit(
      c.env,
      c.get("actor"),
      "note",
      m.id,
      note ? `把 ${m.username} 的备注名改为「${note}」` : `清空 ${m.username} 的备注名`,
    );
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members/:id/link", async (c) => {
  const m = await target(c);
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), await revealMemberToken(c.env, m)) });
});

adminRoutes.post("/:token/members/:id/regenerate", async (c) => {
  const m = await target(c);
  // Disabled members may need a (new) link to pay what they owe; deleted ones never get one.
  if (m.status === "pending" || m.deleted_at) throw badRequest("只能给正常或已停用的成员生成链接");
  const token = await issueMemberToken(c.env, m.id);
  await groupAudit(c.env, c.get("actor"), "link_regen", m.id, `重新生成 ${m.username} 的专属链接`);
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), token) });
});

adminRoutes.post("/:token/members/:id/deactivate", async (c) => {
  const m = await target(c);
  if (m.is_owner) throw badRequest("不能停用群主本人");
  if (m.status !== "active") throw badRequest("这个成员不是正常状态");
  await closeExpired(c.env); // an event past its deadline keeps its sign-ups
  // 操作记录 on each open event this request took them off (RETURNING, so a second click records nothing).
  const recordLeft = async (removed: D1Result | undefined) => {
    const events = new Set((removed?.results ?? []).map((r) => (r as { event_id: number }).event_id));
    for (const id of events)
      await audit(
        c.env,
        id,
        actorId(c.get("actor")),
        "deactivate",
        `停用 ${m.username}，${m.username} 和带的朋友一起移出名单`,
      );
  };
  // `role` is the role this request read (revokeOrganizer has made it 'member' first in the same
  // batch): an appointment landing in between is never undone by a request let through for the old
  // role, e.g. an admin's 停用 of someone the Owner has just made an admin.
  const deactivate = (role: string | null) => [
    // The link keeps working so they can still pay what they owe; sign-up is refused.
    c.env.DB.prepare(
      `UPDATE members SET status = 'inactive' WHERE id = ?1 AND status = 'active'
         AND ${role ? "role IN (?2, 'member')" : `role NOT IN ${STAFF_SQL}`}`,
    ).bind(m.id, ...(role ? [role] : [])),
    // Requirements: deactivating cancels sign-ups for events still open; closed events keep theirs.
    c.env.DB.prepare(
      `DELETE FROM registrations WHERE (member_id = ?1 OR paid_by = ?1) AND event_id IN (SELECT id FROM events WHERE status = 'open')
         AND EXISTS (SELECT 1 FROM members WHERE id = ?1 AND status = 'inactive')
       RETURNING event_id`,
    ).bind(m.id),
  ];
  // An organizer or admin stops being one in the same transaction (design §8), whatever the flag says:
  // their events go back to the Owner and they are told what still pays into their account.
  const revoke = async (who: MemberRow) => {
    let removed: D1Result | undefined;
    let disabled = false;
    const revoked = await revokeOrganizer(c.env, who, "deactivate", {
      with: deactivate(who.role),
      withResults: (r) => {
        disabled = !!r[0]?.meta.changes;
        removed = r[1];
      },
      actor: c.get("actor").memberId,
    });
    if (!disabled) {
      // A second click (or another 停用 meanwhile) finds them disabled already, as before; anything
      // else means their role changed in between and nothing was done.
      const now_ = await requireMember(c.env, who.id);
      if (now_.status !== "inactive") throw badRequest("刚才有别的操作改了他的身份或状态，请刷新页面后再试");
      return c.json({ ok: true, revoked });
    }
    await recordLeft(removed);
    // Revoked meanwhile by someone else (who recorded that): only the 停用 is this request's.
    const also = revoked ? `（同时撤销${ROLE_TITLE[who.role as "admin"] ?? "组织者"}身份）` : "";
    await groupAudit(c.env, c.get("actor"), "deactivate", who.id, `停用 ${who.username}${also}`);
    return c.json({ ok: true, revoked });
  };
  if (isStaff(m.role)) return revoke(m);
  // Not an organizer or admin when read, and still not one when written (an appointment may land in between).
  const [plain, removed] = await c.env.DB.batch(deactivate(null));
  if (plain!.meta.changes) {
    await recordLeft(removed);
    await groupAudit(c.env, c.get("actor"), "deactivate", m.id, `停用 ${m.username}`);
    return c.json({ ok: true, revoked: null });
  }
  const fresh = await requireMember(c.env, m.id);
  if (fresh.status === "active" && isStaff(fresh.role)) {
    // Made an admin while this request was on its way: that is the Owner's alone (access.ts memberTarget).
    assertMayActOn(c.get("actor"), fresh);
    return revoke(fresh);
  }
  throw badRequest("这个成员不是正常状态");
});

adminRoutes.post("/:token/settings/password", async (c) => {
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.current)))) throw new HttpError(401, "wrong_password", "当前密码不正确");
  const next = str(body.next);
  const err = checkPasswordRule(next);
  if (err) throw badRequest(err);
  await setPassword(c.env, next);
  return c.json({ ok: true });
});

/**
 * 备份 TOKEN_KEY: Cloudflare secrets can't be read back, so the Worker itself sends the key to the
 * Owner's Telegram, never to the browser. Needs the password like other rare, sensitive settings.
 */
adminRoutes.post("/:token/settings/backup-key", async (c) => {
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");
  // Its key is derived from the GitHub secret SITES_KEY (scripts/sync-secrets.mjs), backed up there already.
  if (c.env.SITE_ID)
    throw badRequest("这个网站的密钥由网站维护者的 GitHub secret SITES_KEY 生成，已经有备份，不需要再备份");
  const site = isStaging(c.env) ? "测试站" : "正式网站";
  const secret = isStaging(c.env) ? "LINK_ENCRYPTION_KEY_STAGING" : "LINK_ENCRYPTION_KEY";
  const sent = await sendToOwner(
    c.env,
    (l) =>
      `🔑 ${bt(l, "{site}的 TOKEN_KEY（{origin}）：", { site: bt(l, site), origin: escapeHtml(c.env.SITE_ORIGIN) })}\n<pre>${escapeHtml(c.env.TOKEN_KEY)}</pre>\n` +
      bt(
        l,
        "请存进密码管理器，并存为 GitHub secret {secret}，然后删除这条消息。每次部署都会核对它；万一 Worker 的 secret 丢了，部署时会自动用它填回去。",
        { secret: `<code>${secret}</code>` },
      ),
  );
  if (!sent) throw badRequest("发送失败：请先在设置里连接 Telegram");
  return c.json({ ok: true });
});

/** 设置 → Telegram 机器人: a site without the GitHub secret keeps its own bot's token. */
adminRoutes.post("/:token/settings/telegram-bot", async (c) =>
  c.json({ ok: true, botUsername: await saveBotToken(c.env, str((await readJson(c.req.raw)).token).trim()) }),
);

/** 恢复: back to a normal member. Members disabled before links were kept get a fresh link. */
adminRoutes.post("/:token/members/:id/reactivate", async (c) => {
  const m = await target(c);
  if (m.status !== "inactive" || m.deleted_at) throw badRequest("只能恢复已停用的成员");
  const back = c.env.DB.prepare("UPDATE members SET status = 'active' WHERE id = ? AND status = 'inactive'").bind(m.id);
  let restored = false;
  // Back as a plain member: an organizer disabled without being revoked (before 停用 did that) is
  // revoked now, so being one again takes a new appointment.
  if (isStaff(m.role))
    await revokeOrganizer(c.env, m, "owner", {
      with: [back],
      withResults: (r) => {
        restored = !!r[0]?.meta.changes;
      },
      actor: c.get("actor").memberId,
    });
  else restored = !!(await back.run()).meta.changes;
  if (restored)
    await groupAudit(
      c.env,
      c.get("actor"),
      "reactivate",
      m.id,
      `恢复 ${m.username}${isStaff(m.role) ? `（同时撤销${ROLE_TITLE[m.role as "admin"] ?? "组织者"}身份）` : ""}`,
    );
  const link = m.token_enc ? null : memberLink(origin(c.req.url), await issueMemberToken(c.env, m.id));
  return c.json({ ok: true, link });
});

/** 删除: only disabled members with nothing left to pay; their history stays in the records. */
adminRoutes.post("/:token/members/:id/delete", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "inactive" || m.deleted_at) throw badRequest("只能删除已停用的成员");
  // Disabled before 停用 revoked organizers: 恢复 revokes them, so that comes first.
  if (isStaff(m.role))
    throw badRequest(
      `${m.username} 还有${ROLE_TITLE[m.role]}身份。请先「恢复」（会撤销${ROLE_TITLE[m.role]}身份），再停用、删除`,
    );
  const owing = (await owingByMember(c.env)).get(m.id) ?? 0;
  if (owing > 0) throw badRequest(`${m.username} 还有 $${(owing / 100).toFixed(2)} 没付清，付清或标记已付后才能删除`);
  // Still on a list that can change their bill: Finalize, or a fee or roster change after it, would
  // bill someone who no longer has a link. Archived events are fixed, so those don't count.
  const pending = await c.env.DB.prepare(
    `SELECT e.date, e.status FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE (r.member_id = ?1 OR r.paid_by = ?1) AND e.status IN ('open', 'closed', 'finalized') ORDER BY e.start_at LIMIT 1`,
  )
    .bind(m.id)
    .first<{ date: string; status: string }>();
  if (pending)
    throw badRequest(
      pending.status === "finalized"
        ? `${m.username} 还在 ${pending.date} 活动的名单上，这场还没收齐，费用还可能变。请等这场收齐归档，或者把这个人从名单上删掉，再删除成员`
        : `${m.username} 还在 ${pending.date} 活动的名单上，这场还没结算。请先结算这场，或者把这个人从名单上删掉，再删除成员`,
    );
  await assertNotRunning(c.env, m);
  // History stays; the link, the Google account and the name are released, so the person (or
  // someone else with that name) can apply again. The old record keeps the name with its ID
  // appended, e.g. "Alice（M004）", so rosters and rankings never mix the two up.
  const [deleted] = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE members SET deleted_at = ?, token_hash = NULL, token_enc = NULL, google_sub = NULL, username = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(now(), deletedName(m), m.id),
    forgetPush(c.env.DB, m.id),
  ]);
  // A second click finds them deleted already: nothing more to record.
  if (deleted?.meta.changes) await groupAudit(c.env, c.get("actor"), "delete", m.id, `删除成员 ${m.username}`);
  return c.json({ ok: true });
});

export const deletedName = (m: Pick<MemberRow, "id" | "username">) => `${m.username}（${m.id}）`;

async function owingByMember(env: Env, manager: string | null = null): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT member_id, SUM(amount_due_cents - amount_paid_cents) AS owing FROM payments
     WHERE status != 'paid' ${manager ? "AND event_id IN (SELECT id FROM events WHERE manager_id = ?)" : ""}
     GROUP BY member_id`,
  )
    .bind(...(manager ? [manager] : []))
    .all<{ member_id: string; owing: number }>();
  return new Map(results.map((r) => [r.member_id, r.owing]));
}

adminRoutes.post("/:token/settings/rotate-admin", async (c) => {
  const token = await issueAdminToken(c.env);
  return c.json<LinkResponse>({ link: `${origin(c.req.url)}/admin/${token}` });
});

/**
 * 用 Google 登录管理页: the Owner's member record holds one Google account, like any member's, so
 * one account is one person: an account already bound to someone else can't be bound here.
 */
adminRoutes.get("/:token/settings/google", async (c) => {
  const owner = await c.env.DB.prepare("SELECT * FROM members WHERE is_owner = 1").first<MemberRow>();
  const session = await googleSession(c);
  const holder = session ? await memberByGoogle(c.env, session.google_sub) : null;
  return c.json({
    bound: owner?.google_sub ? (owner.google_email ?? "") : null,
    current: session
      ? {
          email: session.email,
          holder: holder && holder.id !== owner?.id ? holder.username : null,
          isOwner: !!holder && holder.id === owner?.id,
        }
      : null,
  });
});

adminRoutes.post("/:token/settings/google/bind", async (c) => {
  requireSameOrigin(c);
  const session = await googleSession(c);
  if (!session) throw new HttpError(401, "login_required", "请先在这个浏览器登录 Google");
  const owner = await c.env.DB.prepare("SELECT * FROM members WHERE is_owner = 1").first<MemberRow>();
  if (!owner) throw new HttpError(404, "member_not_found", "找不到群主的成员记录");
  if (owner.google_sub === session.google_sub) return c.json({ ok: true });
  if (owner.google_sub) throw new HttpError(409, "already_linked", "群主已经绑定了一个 Google 账号，请先解除绑定");
  const holder = await memberByGoogle(c.env, session.google_sub);
  if (holder)
    throw new HttpError(
      409,
      "already_linked",
      `这个 Google 账号已经属于成员「${holder.username}」，一个 Google 账号只能对应一个人`,
    );
  // One email is one person here too (as for members applying or linking with Google).
  if (await emailTaken(c.env, session.email, owner.id))
    throw new HttpError(
      409,
      "email_taken",
      "这个 Google 账号的邮箱已经登记在另一位成员（或待审核的申请）名下，请先处理那条记录或换一个账号",
    );
  // A deleted member keeps their history but lets go of the account.
  await c.env.DB.prepare("UPDATE members SET google_sub = NULL WHERE google_sub = ? AND deleted_at IS NOT NULL")
    .bind(session.google_sub)
    .run();
  await c.env.DB.prepare("UPDATE members SET google_sub = ?, google_email = ? WHERE id = ? AND google_sub IS NULL")
    .bind(session.google_sub, session.email, owner.id)
    .run();
  return c.json({ ok: true });
});

adminRoutes.post("/:token/settings/google/unbind", async (c) => {
  const owner = await ownerId(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE members SET google_sub = NULL WHERE is_owner = 1"),
    // Whoever has that account may have turned push on with it.
    ...(owner ? [forgetPush(c.env.DB, owner)] : []),
  ]);
  return c.json({ ok: true });
});

adminRoutes.route("/:token", adminEventRoutes);

/**
 * 清空所有数据: back to a brand-new site. Only the admin password survives, so the Owner can run
 * first-time setup again at /admin with it (and becomes the Owner member). Needs the password and
 * the typed confirmation; D1 Time Travel can still restore the last 7 days if it was a mistake.
 */
adminRoutes.post("/:token/settings/reset", async (c) => {
  const body = await readJson(c.req.raw);
  if (str(body.confirm) !== RESET_PHRASE) throw badRequest(`请输入「${RESET_PHRASE}」确认`);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");
  await c.env.DB.batch([
    ...RESET_TABLES.map((t) => c.env.DB.prepare(`DELETE FROM ${t}`)),
    c.env.DB.prepare(`DELETE FROM settings WHERE key NOT IN ('admin_password_hash', 'admin_password_env_fp')`),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('next_member_seq', '0')"),
  ]);
  return c.json({ ok: true });
});

const RESET_PHRASE = "清空所有数据";
// Children first, so no foreign key is ever left dangling.
const RESET_TABLES = [
  "group_audit",
  "payment_diagnostics",
  "push_outbox",
  "push_subscriptions",
  "event_audit",
  "payment_aliases",
  "payment_profiles",
  "telegram_bindings",
  "member_sessions",
  "oauth_states",
  "notification_log",
  "email_log",
  "inbound_payments",
  "payment_receipts",
  "payments",
  "settlements",
  "registrations",
  "ai_usage",
  "queue_photos",
  "queue_courts",
  "queue_accounts",
  "calorie_uploads",
  "calories",
  "events",
  "deleted_events",
  "locations",
  "admin_sessions",
  "members",
];
