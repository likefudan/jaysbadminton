import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import { checkPassword, syncEnvPassword } from "./auth";
import { now, getSettings, setSetting } from "./db";
import { createMember, getMember } from "./members";
import { HttpError, readJson, str } from "./http";
import { randomToken, sha256 } from "./lib/crypto";
import { isStaging } from "./site";

const COOKIE = "jb_developer";
type Ctx = Context<{ Bindings: Env }>;
const cookieOptions = (c: Ctx) => ({
  path: "/",
  httpOnly: true,
  secure: new URL(c.req.url).protocol === "https:",
  sameSite: "Strict" as const,
});
const sessionHash = (raw: string) => sha256(`developer:${raw}`);

/** The environment gate is checked before reading any cookie or granting either role. */
export async function developerMember<E extends { Bindings: Env }>(c: Context<E>) {
  if (!isStaging(c.env)) return null;
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  await syncEnvPassword(c.env);
  const session = await c.env.DB.prepare("SELECT 1 FROM admin_sessions WHERE id_hash = ? AND expires_at > ?")
    .bind(await sessionHash(raw), now())
    .first();
  if (!session) return null;
  const settings = await getSettings(c.env.DB, ["developer_member_id"]);
  const member = settings.developer_member_id ? await getMember(c.env, settings.developer_member_id) : null;
  return member && member.status === "active" && !member.deleted_at && !member.is_owner ? member : null;
}

export async function endDeveloperSession(c: Ctx) {
  const raw = getCookie(c, COOKIE);
  if (raw && isStaging(c.env))
    await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id_hash = ?")
      .bind(await sessionHash(raw))
      .run();
  deleteCookie(c, COOKIE, cookieOptions(c));
}

export const developerRoutes = new Hono<{ Bindings: Env }>();
developerRoutes.use("*", async (c, next) => {
  if (!isStaging(c.env)) throw new HttpError(404, "not_found", "找不到这个地址");
  if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.req.url).origin)
    throw new HttpError(403, "csrf", "请求来源无效，请刷新页面重试");
  await next();
});
developerRoutes.get("/session", async (c) => c.json({ signedIn: !!(await developerMember(c)) }));
developerRoutes.post("/login", async (c) => {
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");
  const settings = await getSettings(c.env.DB, ["developer_member_id"]);
  let member = settings.developer_member_id ? await getMember(c.env, settings.developer_member_id) : null;
  if (member?.status !== "active" || member.deleted_at || member.is_owner) {
    member = await createMember(c.env, {
      username: `开发测试${randomToken().slice(0, 6)}`,
      wechatNickname: "开发者测试成员",
      status: "active",
    });
    await setSetting(c.env.DB, "developer_member_id", member.id).run();
  }
  await endDeveloperSession(c);
  const raw = randomToken(),
    expires = new Date(Date.now() + 8 * 3600_000);
  await c.env.DB.prepare("INSERT INTO admin_sessions (id_hash,created_at,expires_at) VALUES (?,?,?)")
    .bind(await sessionHash(raw), now(), expires.toISOString())
    .run();
  setCookie(c, COOKIE, raw, { ...cookieOptions(c), expires });
  return c.json({ ok: true });
});
developerRoutes.post("/logout", async (c) => {
  await endDeveloperSession(c);
  return c.json({ ok: true });
});
