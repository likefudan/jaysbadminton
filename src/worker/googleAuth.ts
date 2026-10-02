import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { now } from "./db";
import { randomToken, sha256, timingSafeEqual } from "./lib/crypto";
import { createMember, memberByToken, type MemberRow } from "./members";
import { HttpError, readJson, str } from "./http";

type Ctx = Context<{ Bindings: Env }>;
export const MEMBER_COOKIE = "jb_member";
const STATE_COOKIE = "jb_google_state";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export const googleEnabled = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const cookieOptions = (c: Ctx) => ({ path: "/", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax" as const });
const loginRequired = () => new HttpError(401, "login_required", "请先使用 Google 登录");

/** Accept only HTTPS avatar URLs from Google's image hosts. Missing profiles still sign in. */
function profilePicture(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com")) ? url.href : null;
  } catch { return null; }
}

/** Cookie-authenticated writes require a same-origin browser request. */
export function requireSameOrigin<E extends { Bindings: Env }>(c: Context<E>) {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) throw new HttpError(403, "csrf", "请求来源无效，请刷新页面重试");
}

export async function googleSession<E extends { Bindings: Env }>(c: Context<E>) {
  const raw = getCookie(c, MEMBER_COOKIE);
  if (!raw) return null;
  return c.env.DB.prepare("SELECT google_sub, email, picture FROM member_sessions WHERE id_hash = ? AND expires_at > ?")
    .bind(await sha256(raw), now()).first<{ google_sub: string; email: string; picture: string | null }>();
}
export async function googleMember<E extends { Bindings: Env }>(c: Context<E>): Promise<MemberRow> {
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const m = await c.env.DB.prepare("SELECT * FROM members WHERE google_sub = ?").bind(session.google_sub).first<MemberRow>();
  if (!m) throw new HttpError(409, "profile_required", "请先完善成员资料");
  if (m.deleted_at || m.status === "pending") throw new HttpError(403, "member_unavailable", "成员账号不可用，请联系管理员");
  return m;
}

export const googleRoutes = new Hono<{ Bindings: Env }>();
googleRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET") requireSameOrigin(c);
  await next();
});
googleRoutes.get("/session", async (c) => {
  const session = await googleSession(c);
  const member = session ? await c.env.DB.prepare("SELECT id, deleted_at, status FROM members WHERE google_sub = ?").bind(session.google_sub).first<{ id: string; deleted_at: string | null; status: string }>() : null;
  return c.json({ enabled: googleEnabled(c.env), signedIn: !!session, email: session?.email ?? null, picture: session?.picture ?? null, hasMember: !!member, unavailable: !!member && (!!member.deleted_at || member.status === "pending") });
});
googleRoutes.get("/google", async (c) => {
  if (!googleEnabled(c.env)) return c.redirect("/login?error=not_configured");
  const state = randomToken(), nonce = randomToken(), verifier = randomToken();
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()),
    c.env.DB.prepare("INSERT INTO oauth_states VALUES (?, ?, ?, ?)").bind(await sha256(state), nonce, verifier, new Date(Date.now() + 600_000).toISOString()),
  ]);
  setCookie(c, STATE_COOKIE, state, { ...cookieOptions(c), maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID!, redirect_uri: `${new URL(c.env.SITE_ORIGIN).origin}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  return c.redirect(url.toString());
});
googleRoutes.get("/google/callback", async (c) => {
  const state = c.req.query("state") ?? "", cookie = getCookie(c, STATE_COOKIE) ?? "";
  deleteCookie(c, STATE_COOKIE, cookieOptions(c));
  if (!googleEnabled(c.env) || !state || !cookie || !timingSafeEqual(state, cookie)) return c.redirect("/login?error=invalid_state");
  const saved = await c.env.DB.prepare("DELETE FROM oauth_states WHERE id_hash = ? AND expires_at > ? RETURNING nonce, verifier")
    .bind(await sha256(state), now()).first<{ nonce: string; verifier: string }>();
  if (!saved) return c.redirect("/login?error=invalid_state");
  if (c.req.query("error")) return c.redirect("/login?error=cancelled");
  const code = c.req.query("code");
  if (!code) return c.redirect("/login?error=failed");
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID!, client_secret: c.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${new URL(c.env.SITE_ORIGIN).origin}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: saved.verifier }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("token exchange failed");
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error("missing ID token");
    const { payload } = await jwtVerify(tokens.id_token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: c.env.GOOGLE_CLIENT_ID!, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce", "email"] });
    if (payload.nonce !== saved.nonce || payload.email_verified !== true || typeof payload.email !== "string" || !payload.sub || (payload.azp !== undefined && payload.azp !== c.env.GOOGLE_CLIENT_ID)) throw new Error("invalid claims");
    const raw = randomToken(), expires = new Date(Date.now() + 30 * 86400_000);
    const old = getCookie(c, MEMBER_COOKIE);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM member_sessions WHERE expires_at < ? OR id_hash = ?").bind(now(), old ? await sha256(old) : ""),
      c.env.DB.prepare("INSERT INTO member_sessions (id_hash, google_sub, email, expires_at, picture) VALUES (?, ?, ?, ?, ?)").bind(await sha256(raw), payload.sub, payload.email, expires.toISOString(), profilePicture(payload.picture)),
    ]);
    setCookie(c, MEMBER_COOKIE, raw, { ...cookieOptions(c), expires });
    return c.redirect("/me");
  } catch {
    // Never log codes, tokens, or provider responses.
    return c.redirect("/login?error=failed");
  }
});
googleRoutes.post("/register", async (c) => {
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const existing = await c.env.DB.prepare("SELECT id FROM members WHERE google_sub = ?").bind(session.google_sub).first();
  if (existing) throw new HttpError(409, "already_registered", "此 Google 账号已关联成员，请返回我的页面");
  const body = await readJson(c.req.raw);
  const m = await createMember(c.env, { username: str(body.username), wechatNickname: str(body.wechatNickname), status: "active", googleSub: session.google_sub, googleEmail: session.email });
  return c.json({ id: m.id });
});
googleRoutes.post("/link", async (c) => {
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const body = await readJson(c.req.raw);
  const m = await memberByToken(c.env, str(body.token));
  if (!m) throw new HttpError(403, "invalid_link", "原成员链接无效，请联系管理员");
  if (m.google_sub === session.google_sub) return c.json({ ok: true });
  try {
    const result = await c.env.DB.prepare("UPDATE members SET google_sub = ?, google_email = ? WHERE id = ? AND google_sub IS NULL AND deleted_at IS NULL")
      .bind(session.google_sub, session.email, m.id).run();
    if (!result.meta.changes) throw new Error("already linked");
  } catch {
    throw new HttpError(409, "already_linked", "此成员或 Google 账号已绑定，请使用原账号登录");
  }
  return c.json({ ok: true });
});
googleRoutes.post("/logout", async (c) => {
  const raw = getCookie(c, MEMBER_COOKIE);
  if (raw) await c.env.DB.prepare("DELETE FROM member_sessions WHERE id_hash = ?").bind(await sha256(raw)).run();
  deleteCookie(c, MEMBER_COOKIE, cookieOptions(c));
  return c.json({ ok: true });
});
