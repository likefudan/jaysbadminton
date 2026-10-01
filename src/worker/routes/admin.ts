import { Hono } from "hono";
import { checkPassword as checkPasswordRule } from "../../shared/rules";
import type { LinkResponse, MembersResponse } from "../../shared/types";
import { assertAdminToken, checkPassword, endSession, hasSession, issueAdminToken, setPassword, startSession } from "../auth";
import { now } from "../db";
import type { Env } from "../env";
import { HttpError, badRequest, readJson, str } from "../http";
import { adminEventRoutes } from "./adminEvents";
import { type MemberRow, issueMemberToken, memberLink, requireMember, revealMemberToken, toSummary } from "../members";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("/:token/*", async (c, next) => {
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
  const token = await issueMemberToken(c.env, m.id);
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), token) });
});

adminRoutes.post("/:token/members/:id/reject", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.status !== "pending") throw badRequest("只能拒绝待审核的申请");
  await c.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(m.id).run();
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
  await c.env.DB.prepare("UPDATE members SET deleted_at = ?, token_hash = NULL, token_enc = NULL WHERE id = ?").bind(now(), m.id).run();
  return c.json({ ok: true });
});

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
  "notification_log",
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
