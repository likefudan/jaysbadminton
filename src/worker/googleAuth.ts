import { developerMember, endDeveloperSession } from "./developer";
import { sendApplicationNotice } from "./approvalEmail";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { now } from "./db";
import { randomToken, sha256, timingSafeEqual } from "./lib/crypto";
import { assertPendingRoom, createMember, emailTaken, memberByToken, type MemberRow } from "./members";
import { HttpError, readJson, str } from "./http";
import { memberRole, organizersEnabled } from "./organizers";

type Ctx = Context<{ Bindings: Env }>;
export const MEMBER_COOKIE = "jb_member";
const STATE_COOKIE = "jb_google_state";
const NEXT_COOKIE = "jb_google_next";
/** Where to land after Google: only this site's own pages, never another host. */
const safeNext = (v: string | undefined) => (v && /^\/(me|admin\/[\w-]+)(\?[\w=&-]*)?$/.test(v) ? v : null);
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export const googleEnabled = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const cookieOptions = (c: Ctx) => ({
  path: "/",
  httpOnly: true,
  secure: new URL(c.req.url).protocol === "https:",
  sameSite: "Lax" as const,
});
const loginRequired = () => new HttpError(401, "login_required", "请先使用 Google 登录");
/** One email is one person: a Google account whose email another member already holds is refused. */
const googleEmailTaken = () =>
  new HttpError(409, "email_taken", "这个 Google 账号的邮箱已经登记在另一位成员名下，请联系群主");

/** Accept only HTTPS avatar URLs from Google's image hosts. Missing profiles still sign in. */
function profilePicture(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Cookie-authenticated writes require a same-origin browser request. */
export function requireSameOrigin<E extends { Bindings: Env }>(c: Context<E>) {
  if (c.req.header("Origin") !== new URL(c.req.url).origin)
    throw new HttpError(403, "csrf", "请求来源无效，请刷新页面重试");
}

export async function googleSession<E extends { Bindings: Env }>(c: Context<E>) {
  const raw = getCookie(c, MEMBER_COOKIE);
  if (!raw) return null;
  return c.env.DB.prepare("SELECT google_sub, email, picture FROM member_sessions WHERE id_hash = ? AND expires_at > ?")
    .bind(await sha256(raw), now())
    .first<{ google_sub: string; email: string; picture: string | null }>();
}
/** The live member a Google account belongs to; deleted members no longer hold their account. */
export const memberByGoogle = (env: Env, sub: string) =>
  env.DB.prepare("SELECT * FROM members WHERE google_sub = ? AND deleted_at IS NULL").bind(sub).first<MemberRow>();

export async function googleMember<E extends { Bindings: Env }>(c: Context<E>): Promise<MemberRow> {
  const developer = await developerMember(c);
  if (developer) return developer;
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const m = await memberByGoogle(c.env, session.google_sub);
  if (!m) throw new HttpError(409, "profile_required", "请先完善成员资料");
  if (m.status === "pending")
    throw new HttpError(403, "pending_approval", "你的入群申请正在等待审核，通过后才能报名活动");
  return m;
}

export const googleRoutes = new Hono<{ Bindings: Env }>();
googleRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET") requireSameOrigin(c);
  await next();
});
googleRoutes.get("/session", async (c) => {
  if (await developerMember(c))
    return c.json({
      enabled: googleEnabled(c.env),
      signedIn: true,
      email: null,
      picture: null,
      hasMember: true,
      pending: false,
      role: "member",
      organizers: organizersEnabled(c.env),
      developer: true,
    });
  const session = await googleSession(c);
  const member = session ? await memberByGoogle(c.env, session.google_sub) : null;
  return c.json({
    enabled: googleEnabled(c.env),
    signedIn: !!session,
    email: session?.email ?? null,
    picture: session?.picture ?? null,
    hasMember: !!member && member.status !== "pending",
    pending: member?.status === "pending",
    emailNotificationsEnabled: !!(c.env.RESEND_API_KEY && c.env.EMAIL_FROM),
    // What the admin pages let them do: owner, organizer (only while the flag is on) or member.
    role: member && member.status === "active" ? memberRole(c.env, member) : "member",
    // Whether the 组织者 feature is on, so pages keep their old wording while it is off.
    organizers: organizersEnabled(c.env),
  });
});
googleRoutes.get("/google", async (c) => {
  if (!googleEnabled(c.env)) return c.redirect("/login?error=not_configured");
  const state = randomToken(),
    nonce = randomToken(),
    verifier = randomToken();
  const challenge = btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()),
    c.env.DB.prepare("INSERT INTO oauth_states VALUES (?, ?, ?, ?)").bind(
      await sha256(state),
      nonce,
      verifier,
      new Date(Date.now() + 600_000).toISOString(),
    ),
  ]);
  setCookie(c, STATE_COOKIE, state, { ...cookieOptions(c), maxAge: 600 });
  const next = safeNext(c.req.query("next"));
  if (next) setCookie(c, NEXT_COOKIE, next, { ...cookieOptions(c), maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${new URL(c.env.SITE_ORIGIN).origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return c.redirect(url.toString());
});
googleRoutes.get("/google/callback", async (c) => {
  const state = c.req.query("state") ?? "",
    cookie = getCookie(c, STATE_COOKIE) ?? "";
  const next = safeNext(getCookie(c, NEXT_COOKIE)) ?? "/me";
  deleteCookie(c, STATE_COOKIE, cookieOptions(c));
  if (getCookie(c, NEXT_COOKIE)) deleteCookie(c, NEXT_COOKIE, cookieOptions(c));
  if (!googleEnabled(c.env) || !state || !cookie || !timingSafeEqual(state, cookie))
    return c.redirect("/login?error=invalid_state");
  const saved = await c.env.DB.prepare(
    "DELETE FROM oauth_states WHERE id_hash = ? AND expires_at > ? RETURNING nonce, verifier",
  )
    .bind(await sha256(state), now())
    .first<{ nonce: string; verifier: string }>();
  if (!saved) return c.redirect("/login?error=invalid_state");
  if (c.req.query("error")) return c.redirect("/login?error=cancelled");
  const code = c.req.query("code");
  if (!code) return c.redirect("/login?error=failed");
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID!,
        client_secret: c.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${new URL(c.env.SITE_ORIGIN).origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("token exchange failed");
    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("missing ID token");
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: c.env.GOOGLE_CLIENT_ID!,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nonce", "email"],
    });
    if (
      payload.nonce !== saved.nonce ||
      payload.email_verified !== true ||
      typeof payload.email !== "string" ||
      !payload.sub ||
      (payload.azp !== undefined && payload.azp !== c.env.GOOGLE_CLIENT_ID)
    )
      throw new Error("invalid claims");
    const raw = randomToken(),
      expires = new Date(Date.now() + 30 * 86400_000);
    const old = getCookie(c, MEMBER_COOKIE);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM member_sessions WHERE expires_at < ? OR id_hash = ?").bind(
        now(),
        old ? await sha256(old) : "",
      ),
      c.env.DB.prepare(
        "INSERT INTO member_sessions (id_hash, google_sub, email, expires_at, picture) VALUES (?, ?, ?, ?, ?)",
      ).bind(await sha256(raw), payload.sub, payload.email, expires.toISOString(), profilePicture(payload.picture)),
    ]);
    setCookie(c, MEMBER_COOKIE, raw, { ...cookieOptions(c), expires });
    return c.redirect(next);
  } catch {
    // Never log codes, tokens, or provider responses.
    return c.redirect("/login?error=failed");
  }
});
googleRoutes.post("/register", async (c) => {
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const existing = await memberByGoogle(c.env, session.google_sub);
  if (existing?.status === "pending") throw new HttpError(409, "already_applied", "你的入群申请已经提交，请等待审核");
  if (existing) throw new HttpError(409, "already_registered", "此 Google 账号已关联成员，请返回我的页面");
  const body = await readJson(c.req.raw);
  if (await emailTaken(c.env, session.email)) throw googleEmailTaken();
  await assertPendingRoom(c.env);
  // A deleted member keeps their history but lets go of the Google account, so it can apply anew.
  await c.env.DB.prepare("UPDATE members SET google_sub = NULL WHERE google_sub = ? AND deleted_at IS NOT NULL")
    .bind(session.google_sub)
    .run();
  // Like 申请加入: the Owner approves every newcomer before they can sign up for anything.
  // Same two names as 申请加入 (用户名 for the roster, 微信名 for the admin), plus an optional note.
  const m = await createMember(c.env, {
    username: str(body.username),
    wechatNickname: str(body.wechatNickname),
    message: str(body.message),
    status: "pending",
    googleSub: session.google_sub,
    googleEmail: session.email,
  });
  try {
    await sendApplicationNotice(c.env, m);
  } catch {
    /* The admin queue remains authoritative if Telegram is unavailable. */
  }
  return c.json({ id: m.id, pending: true });
});
googleRoutes.post("/link", async (c) => {
  const session = await googleSession(c);
  if (!session) throw loginRequired();
  const body = await readJson(c.req.raw);
  const m = await memberByToken(c.env, str(body.token));
  if (!m) throw new HttpError(403, "invalid_link", "原成员链接无效，请联系群主");
  if (m.google_sub === session.google_sub) return c.json({ ok: true });
  const holder = await memberByGoogle(c.env, session.google_sub);
  if (holder) throw new HttpError(409, "already_linked", "此成员或 Google 账号已绑定，请使用原账号登录");
  // The member's own email may match; anyone else's may not.
  if (await emailTaken(c.env, session.email, m.id)) throw googleEmailTaken();
  try {
    const result = await c.env.DB.prepare(
      "UPDATE members SET google_sub = ?, google_email = ? WHERE id = ? AND google_sub IS NULL AND deleted_at IS NULL",
    )
      .bind(session.google_sub, session.email, m.id)
      .run();
    if (!result.meta.changes) throw new Error("already linked");
  } catch {
    throw new HttpError(409, "already_linked", "此成员或 Google 账号已绑定，请使用原账号登录");
  }
  return c.json({ ok: true });
});
googleRoutes.post("/logout", async (c) => {
  await endDeveloperSession(c);
  const raw = getCookie(c, MEMBER_COOKIE);
  if (raw)
    await c.env.DB.prepare("DELETE FROM member_sessions WHERE id_hash = ?")
      .bind(await sha256(raw))
      .run();
  deleteCookie(c, MEMBER_COOKIE, cookieOptions(c));
  return c.json({ ok: true });
});
