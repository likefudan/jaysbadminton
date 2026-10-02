import { Hono } from "hono";
import { checkPassword as checkPasswordRule } from "../../shared/rules";
import type { ApproveResponse, LinkResponse, MemberProfile, MembersResponse } from "../../shared/types";
import { assertAdminToken, checkPassword, endSession, hasSession, issueAdminToken, setPassword, startSession } from "../auth";
import { now } from "../db";
import type { Env } from "../env";
import { HttpError, badRequest, readJson, str } from "../http";
import { adminEventRoutes } from "./adminEvents";
import { type MemberRow, issueMemberToken, memberLink, requireMember, revealMemberToken, toSummary } from "../members";
import { memberProfile, setAdminNote } from "../profile";
import { googleOwner, googleSession, memberByGoogle, requireSameOrigin } from "../googleAuth";

/** /admin/google: the admin page reached through the Owner's own Google account instead of the link. */
export const GOOGLE_ADMIN = "google";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("/:token/*", async (c, next) => {
  if (c.req.param("token") === GOOGLE_ADMIN) {
    // The Google cookie is SameSite=Lax (the admin one is Strict), so writes must come from this site.
    if (c.req.method !== "GET") requireSameOrigin(c);
    if (!(await googleOwner(c))) throw new HttpError(401, "google_admin_required", "请用管理员绑定的 Google 账号登录");
    return next();
  }
  await assertAdminToken(c.env, c.req.param("token"));
  if (!c.req.path.endsWith("/login") && !(await hasSession(c))) {
    throw new HttpError(401, "login_required", "请输入管理密码");
  }
  await next();
});

adminRoutes.post("/:token/login", async (c) => {
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");
  await startSession(c);
  return c.json({ ok: true });
});

adminRoutes.post("/:token/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM members ORDER BY id").all<MemberRow>();
  const owing = await owingByMember(c.env);
  const all = results.map((m) => ({ ...toSummary(m), owingCents: owing.get(m.id) ?? 0 }));
  return c.json<MembersResponse>({
    pending: all.filter((m) => m.status === "pending"),
    active: all.filter((m) => m.status === "active"),
    inactive: all.filter((m) => m.status === "inactive" && !m.deletedAt),
    deleted: all.filter((m) => !!m.deletedAt),
  });
});

const origin = (url: string) => new URL(url).origin;

adminRoutes.post("/:token/members/:id/approve", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "pending") throw badRequest("这个申请已经处理过了");
  await c.env.DB.prepare("UPDATE members SET status = 'active', approved_at = ? WHERE id = ?").bind(now(), m.id).run();
  // Applied with Google: they sign in with it, so there is no link to send (a spare one can still
  // be made from the members list).
  if (m.google_sub) return c.json<ApproveResponse>({ link: null, googleEmail: m.google_email });
  const token = await issueMemberToken(c.env, m.id);
  return c.json<ApproveResponse>({ link: memberLink(origin(c.req.url), token), googleEmail: null });
});

adminRoutes.post("/:token/members/:id/reject", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "pending") throw badRequest("只能拒绝待审核的申请");
  await c.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(m.id).run();
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members/:id/profile", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  return c.json<MemberProfile>({ ...(await memberProfile(c.env, m)), adminNote: m.admin_note ?? "" });
});

adminRoutes.post("/:token/members/:id/note", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  await setAdminNote(c.env, m, str((await readJson(c.req.raw)).note));
  return c.json({ ok: true });
});

adminRoutes.get("/:token/members/:id/link", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), await revealMemberToken(c.env, m)) });
});

adminRoutes.post("/:token/members/:id/regenerate", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  // Disabled members may need a (new) link to pay what they owe; deleted ones never get one.
  if (m.status === "pending" || m.deleted_at) throw badRequest("只能给正常或已停用的成员生成链接");
  const token = await issueMemberToken(c.env, m.id);
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), token) });
});

adminRoutes.post("/:token/members/:id/deactivate", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.is_owner) throw badRequest("不能停用管理员自己");
  if (m.status !== "active") throw badRequest("这个成员不是正常状态");
  await c.env.DB.batch([
    // The link keeps working so they can still pay what they owe; sign-up is refused.
    c.env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(m.id),
    // Requirements: deactivating cancels sign-ups for events still open; closed events keep theirs.
    c.env.DB.prepare(
      "DELETE FROM registrations WHERE member_id = ? AND event_id IN (SELECT id FROM events WHERE status = 'open')",
    ).bind(m.id),
  ]);
  return c.json({ ok: true });
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

/** 恢复: back to a normal member. Members disabled before links were kept get a fresh link. */
adminRoutes.post("/:token/members/:id/reactivate", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "inactive" || m.deleted_at) throw badRequest("只能恢复已停用的成员");
  await c.env.DB.prepare("UPDATE members SET status = 'active' WHERE id = ?").bind(m.id).run();
  const link = m.token_enc ? null : memberLink(origin(c.req.url), await issueMemberToken(c.env, m.id));
  return c.json({ ok: true, link });
});

/** 删除: only disabled members with nothing left to pay; their history stays in the records. */
adminRoutes.post("/:token/members/:id/delete", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "inactive" || m.deleted_at) throw badRequest("只能删除已停用的成员");
  const owing = (await owingByMember(c.env)).get(m.id) ?? 0;
  if (owing > 0) throw badRequest(`${m.username} 还有 $${(owing / 100).toFixed(2)} 没付清，付清或标记已付后才能删除`);
  // History stays; the link, the Google account and the name are released, so the person (or
  // someone else with that name) can apply again. The old record keeps the name with its ID
  // appended, e.g. "Alice（M004）", so rosters and rankings never mix the two up.
  await c.env.DB.prepare(
    "UPDATE members SET deleted_at = ?, token_hash = NULL, token_enc = NULL, google_sub = NULL, username = ? WHERE id = ?",
  )
    .bind(now(), deletedName(m), m.id)
    .run();
  return c.json({ ok: true });
});

export const deletedName = (m: Pick<MemberRow, "id" | "username">) => `${m.username}（${m.id}）`;

async function owingByMember(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT member_id, SUM(amount_due_cents - amount_paid_cents) AS owing FROM payments
     WHERE status != 'paid' GROUP BY member_id`,
  ).all<{ member_id: string; owing: number }>();
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
    bound: owner?.google_sub ? owner.google_email ?? "" : null,
    current: session ? { email: session.email, holder: holder && holder.id !== owner?.id ? holder.username : null, isOwner: !!holder && holder.id === owner?.id } : null,
  });
});

adminRoutes.post("/:token/settings/google/bind", async (c) => {
  requireSameOrigin(c);
  const session = await googleSession(c);
  if (!session) throw new HttpError(401, "login_required", "请先在这个浏览器登录 Google");
  const owner = await c.env.DB.prepare("SELECT * FROM members WHERE is_owner = 1").first<MemberRow>();
  if (!owner) throw new HttpError(404, "member_not_found", "找不到管理员的成员记录");
  if (owner.google_sub === session.google_sub) return c.json({ ok: true });
  if (owner.google_sub) throw new HttpError(409, "already_linked", "管理员已经绑定了一个 Google 账号，请先解除绑定");
  const holder = await memberByGoogle(c.env, session.google_sub);
  if (holder) throw new HttpError(409, "already_linked", `这个 Google 账号已经属于成员「${holder.username}」，一个 Google 账号只能对应一个人`);
  // A deleted member keeps their history but lets go of the account.
  await c.env.DB.prepare("UPDATE members SET google_sub = NULL WHERE google_sub = ? AND deleted_at IS NOT NULL").bind(session.google_sub).run();
  await c.env.DB.prepare("UPDATE members SET google_sub = ?, google_email = ? WHERE id = ? AND google_sub IS NULL")
    .bind(session.google_sub, session.email, owner.id)
    .run();
  return c.json({ ok: true });
});

adminRoutes.post("/:token/settings/google/unbind", async (c) => {
  await c.env.DB.prepare("UPDATE members SET google_sub = NULL WHERE is_owner = 1").run();
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
  "member_sessions",
  "oauth_states",
  "notification_log",
  "email_log",
  "inbound_payments",
  "payment_receipts",
  "payments",
  "settlements",
  "registrations",
  "events",
  "locations",
  "admin_sessions",
  "members",
];
