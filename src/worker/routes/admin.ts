import { Hono } from "hono";
import { checkPassword as checkPasswordRule } from "../../shared/rules";
import type { LinkResponse, MembersResponse } from "../../shared/types";
import { assertAdminToken, checkPassword, endSession, hasSession, issueAdminToken, setPassword, startSession } from "../auth";
import { now } from "../db";
import type { Env } from "../env";
import { HttpError, badRequest, readJson, str } from "../http";
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
  const all = results.map(toSummary);
  return c.json<MembersResponse>({
    pending: all.filter((m) => m.status === "pending"),
    active: all.filter((m) => m.status === "active"),
    inactive: all.filter((m) => m.status === "inactive"),
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
  if (m.status !== "active") throw badRequest("只能给正常状态的成员重新生成链接");
  const token = await issueMemberToken(c.env, m.id);
  return c.json<LinkResponse>({ link: memberLink(origin(c.req.url), token) });
});

adminRoutes.post("/:token/members/:id/deactivate", async (c) => {
  const m = await requireMember(c.env, c.req.param("id"));
  if (m.is_owner) throw badRequest("不能停用管理员自己");
  if (m.status !== "active") throw badRequest("这个成员不是正常状态");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE members SET status = 'inactive', token_hash = NULL, token_enc = NULL WHERE id = ?").bind(m.id),
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

adminRoutes.post("/:token/settings/rotate-admin", async (c) => {
  const token = await issueAdminToken(c.env);
  return c.json<LinkResponse>({ link: `${origin(c.req.url)}/admin/${token}` });
});
