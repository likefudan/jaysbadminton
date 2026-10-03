import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { decryptToken, encryptToken, hashPassword, hmac, randomToken, sha256, verifyPassword } from "./lib/crypto";
import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import { HttpError, invalidLink } from "./http";

export const SESSION_COOKIE = "jb_admin";
const SESSION_DAYS = 30;

type Ctx = Context<{ Bindings: Env }>;

/**
 * Makes the stored password follow the ADMIN_PASSWORD secret: when the secret changes (the
 * recovery path), the stored hash is replaced and every session is signed out. Password changes
 * made in the admin page are kept until the secret itself changes again.
 */
export async function syncEnvPassword(env: Env): Promise<void> {
  if (!env.ADMIN_PASSWORD || !env.TOKEN_KEY) throw new HttpError(500, "misconfigured", "系统尚未配置管理密码");
  const fp = await hmac(`admin-password:${env.ADMIN_PASSWORD}`, env.TOKEN_KEY);
  const s = await getSettings(env.DB, ["admin_password_env_fp"]);
  if (s.admin_password_env_fp === fp) return;
  await env.DB.batch([
    setSetting(env.DB, "admin_password_hash", await hashPassword(env.ADMIN_PASSWORD, env.TOKEN_KEY)),
    setSetting(env.DB, "admin_password_env_fp", fp),
    env.DB.prepare("DELETE FROM admin_sessions"),
  ]);
}

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Verifies the admin password. After 5 wrong attempts, all password checks are refused for
 * 15 minutes, which keeps the login and first-time setup forms from being brute-forced.
 *
 * Each attempt is counted with one atomic increment before the password is checked, so a burst
 * of parallel requests can't all read the same count and slip past the limit.
 */
export async function checkPassword(env: Env, password: string): Promise<boolean> {
  await syncEnvPassword(env);
  const s = await getSettings(env.DB, ["admin_password_hash", "admin_login_locked_until"]);
  if (s.admin_login_locked_until && s.admin_login_locked_until > now()) throw locked();
  const attempt = await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_login_failures', '1')
     ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value`,
  ).first<{ value: string }>();
  const n = Number(attempt!.value);
  if (n > MAX_FAILURES) {
    await lock(env);
    throw locked();
  }
  const ok = !!s.admin_password_hash && (await verifyPassword(password, s.admin_password_hash, env.TOKEN_KEY));
  if (ok) {
    await setSetting(env.DB, "admin_login_failures", "0").run();
    return true;
  }
  if (n === MAX_FAILURES) await lock(env);
  return false;
}

function locked(): HttpError {
  return new HttpError(429, "locked", `密码错误次数过多，请 ${LOCK_MINUTES} 分钟后再试`);
}

async function lock(env: Env): Promise<void> {
  await env.DB.batch([
    setSetting(env.DB, "admin_login_failures", "0"),
    setSetting(env.DB, "admin_login_locked_until", new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()),
  ]);
}

export async function setPassword(env: Env, password: string): Promise<void> {
  await env.DB.batch([
    setSetting(env.DB, "admin_password_hash", await hashPassword(password, env.TOKEN_KEY)),
    env.DB.prepare("DELETE FROM admin_sessions"),
  ]);
}

export async function adminLinkExists(env: Env): Promise<boolean> {
  const s = await getSettings(env.DB, ["admin_token_hash"]);
  return !!s.admin_token_hash;
}

/**
 * Creates (or replaces) the admin link token and returns the raw token. It is kept hashed (to
 * check links) and encrypted (so the Owner's Telegram can be sent the link again).
 */
export async function issueAdminToken(env: Env): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    setSetting(env.DB, "admin_token_hash", await sha256(token)),
    setSetting(env.DB, "admin_token_enc", await encryptToken(token, env.TOKEN_KEY)),
  ]);
  return token;
}

/** The current admin link token, or a new one when the stored link predates encryption. */
export async function currentAdminToken(env: Env): Promise<{ token: string; renewed: boolean }> {
  const s = await getSettings(env.DB, ["admin_token_hash", "admin_token_enc"]);
  if (s.admin_token_hash && s.admin_token_enc) {
    const token = await decryptToken(s.admin_token_enc, env.TOKEN_KEY);
    if ((await sha256(token)) === s.admin_token_hash) return { token, renewed: false };
  }
  return { token: await issueAdminToken(env), renewed: true };
}

export async function assertAdminToken(env: Env, token: string): Promise<void> {
  const s = await getSettings(env.DB, ["admin_token_hash"]);
  if (!s.admin_token_hash || s.admin_token_hash !== (await sha256(token))) throw invalidLink();
}

export async function startSession(c: Ctx): Promise<void> {
  const raw = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now()),
    c.env.DB.prepare("INSERT INTO admin_sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)").bind(
      await sha256(raw),
      now(),
      expires.toISOString(),
    ),
  ]);
  setCookie(c, SESSION_COOKIE, raw, {
    path: "/api/admin",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    expires,
  });
}

export async function hasSession(c: Ctx): Promise<boolean> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return false;
  await syncEnvPassword(c.env);
  const row = await c.env.DB.prepare("SELECT 1 FROM admin_sessions WHERE id_hash = ? AND expires_at > ?")
    .bind(await sha256(raw), now())
    .first();
  return !!row;
}

export async function endSession(c: Ctx): Promise<void> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (raw) await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id_hash = ?").bind(await sha256(raw)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/api/admin" });
}
