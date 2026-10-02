import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker/index";
import { sha256 } from "../src/worker/lib/crypto";
import { createMember, issueMemberToken } from "../src/worker/members";
import { createTestEvent, setUpAdmin } from "./helpers";

const ORIGIN = "https://jaysbadminton.test";
const bindings = () => ({ ...env, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", SITE_ORIGIN: ORIGIN });
const request = (path: string, cookie = "", body?: unknown, origin = ORIGIN) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
}), bindings(), {} as ExecutionContext);

let privateKey: CryptoKey, jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...await exportJWK(pair.publicKey), kid: "google-test", alg: "RS256", use: "sig" };
});
afterEach(() => vi.restoreAllMocks());

async function begin() {
  const res = await request("/api/auth/google");
  expect(res.status).toBe(302);
  const url = new URL(res.headers.get("Location")!);
  return { url, state: url.searchParams.get("state")!, cookie: res.headers.get("Set-Cookie")!.split(";")[0]! };
}
async function login(claims: Record<string, unknown> = {}, options: { audience?: string; issuer?: string; expires?: string; badSignature?: boolean } = {}) {
  const start = await begin();
  const token = await new SignJWT({ email: "alice@gmail.com", email_verified: true, nonce: start.url.searchParams.get("nonce"), ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setSubject("google-alice")
    .setIssuer(options.issuer ?? "https://accounts.google.com").setAudience(options.audience ?? "test-client").setIssuedAt().setExpirationTime(options.expires ?? "5m")
    .sign(options.badSignature ? (await generateKeyPair("RS256")).privateKey : privateKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String(init?.body)).toContain("code_verifier=");
    expect(String(init?.body)).toContain("client_secret=test-secret");
    return Response.json({ id_token: token });
  });
  const response = await request(`/api/auth/google/callback?state=${start.state}&code=valid-code`, start.cookie);
  const cookie = response.headers.get("Set-Cookie")?.match(/jb_member=([^; ,]+)/)?.[0] ?? "";
  return { response, cookie, start };
}
async function session(sub = "google-alice", expires = new Date(Date.now() + 60_000).toISOString()) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO member_sessions (id_hash, google_sub, email, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), sub, "alice@gmail.com", expires).run();
  return `jb_member=${token}`;
}

describe("Google authorization flow", () => {
  it("uses state, nonce, PKCE, profile scopes and the configured callback", async () => {
    const { url } = await begin();
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get("client_secret")).toBeNull();
  });
  it("validates a signed Google ID token and issues an HttpOnly session, rejecting replay", async () => {
    const { response, cookie, start } = await login();
    expect(response.headers.get("Location")).toBe("/me");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
    expect((await (await request("/api/auth/session", cookie)).json() as any).signedIn).toBe(true);
    const replay = await request(`/api/auth/google/callback?state=${start.state}&code=valid-code`, start.cookie);
    expect(replay.headers.get("Location")).toBe("/login?error=invalid_state");
  });
  it.each([
    ["https://lh3.googleusercontent.com/a/avatar", "https://lh3.googleusercontent.com/a/avatar"],
    [undefined, null],
    ["http://lh3.googleusercontent.com/avatar", null],
    ["https://googleusercontent.com.evil.test/avatar", null],
    ["not-a-url", null],
  ])("stores a safe optional profile picture %s", async (picture, expected) => {
    const { response, cookie } = await login({ picture });
    expect(response.headers.get("Location")).toBe("/me");
    const result = await (await request("/api/auth/session", cookie)).json();
    expect(result).toMatchObject({ signedIn: true, email: "alice@gmail.com", picture: expected });
  });
  it.each([{ email_verified: false }, { nonce: "wrong-nonce" }])("rejects invalid identity claims %j", async (claims) => {
    const { response, cookie } = await login(claims);
    expect(response.headers.get("Location")).toBe("/login?error=failed");
    expect(cookie).toBe("");
  });
  it("rejects state without the same browser cookie and handles cancellation", async () => {
    const start = await begin();
    expect((await request(`/api/auth/google/callback?state=${start.state}&code=x`)).headers.get("Location")).toContain("invalid_state");
    expect((await request(`/api/auth/google/callback?state=${start.state}&error=access_denied`, start.cookie)).headers.get("Location")).toContain("cancelled");
  });
  it.each([{ audience: "different-client" }, { issuer: "https://evil.test" }, { expires: "-1m" }, { badSignature: true }])("rejects untrusted or expired tokens %j", async (options) => {
    const { response, cookie } = await login({}, options);
    expect(response.headers.get("Location")).toBe("/login?error=failed");
    expect(cookie).toBe("");
  });
  it("rejects an expired authorization request", async () => {
    const start = await begin();
    await env.DB.prepare("UPDATE oauth_states SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await request(`/api/auth/google/callback?state=${start.state}&code=x`, start.cookie)).headers.get("Location")).toContain("invalid_state");
  });
});

describe("Google member access", () => {
  it("registers an active non-admin member without a link, then permits signup", async () => {
    const ctx = await setUpAdmin();
    const event = await createTestEvent(ctx);
    const cookie = await session();
    expect((await request("/api/auth/register", cookie, { username: "Alice", wechatNickname: "Alice微信" })).status).toBe(200);
    const me = await (await request("/api/m/session/me", cookie)).json() as any;
    expect(me).toMatchObject({ username: "Alice", active: true, isOwner: false });
    expect((await request(`/api/m/session/events/${event.id}/signup`, cookie, { friends: [] })).status).toBe(200);
    expect((await request(`${ctx.base}/members`, cookie)).status).toBe(401);
    const m = await env.DB.prepare("SELECT token_hash FROM members WHERE id = ?").bind(me.id).first();
    expect(m?.token_hash).toBeNull();
    expect((await request("/api/auth/register", cookie, { username: "Other", wechatNickname: "Other" })).status).toBe(409);
  });
  it("requires login and rejects expired sessions and cross-origin writes", async () => {
    expect((await request("/api/m/session/me")).status).toBe(401);
    const expired = await session("expired", new Date(Date.now() - 1000).toISOString());
    expect((await request("/api/m/session/me", expired)).status).toBe(401);
    const cookie = await session();
    expect((await request("/api/auth/register", cookie, { username: "Alice", wechatNickname: "Alice" }, "https://evil.test")).status).toBe(403);
    expect((await request("/api/m/session/rename", cookie, { username: "Oops" }, "https://evil.test")).status).toBe(403);
  });
  it("binds an existing member without changing ID, token or records and prevents reassignment", async () => {
    const m = await createMember(env, { username: "Alice", wechatNickname: "Alice", status: "active" });
    const token = await issueMemberToken(env, m.id);
    const cookie = await session();
    expect((await request("/api/auth/link", cookie, { token })).status).toBe(200);
    expect((await (await request("/api/m/session/me", cookie)).json() as any).id).toBe(m.id);
    expect((await request(`/api/m/${token}/me`)).status).toBe(200);
    expect((await request("/api/auth/link", cookie, { token })).status).toBe(200);
    const other = await createMember(env, { username: "Other", wechatNickname: "Other", status: "active" });
    const otherToken = await issueMemberToken(env, other.id);
    expect((await request("/api/auth/link", cookie, { token: otherToken })).status).toBe(409);
    expect((await request("/api/auth/link", await session("other-google"), { token })).status).toBe(409);
    expect((await request("/api/auth/link", cookie, { token: "wrong" })).status).toBe(403);
  });
  it("does not merge people by matching usernames and keeps disabled/deleted restrictions", async () => {
    const ctx = await setUpAdmin();
    const event = await createTestEvent(ctx);
    const m = await createMember(env, { username: "Alice", wechatNickname: "Alice", status: "inactive", googleSub: "google-alice" });
    const cookie = await session();
    expect((await request("/api/m/session/me", cookie)).status).toBe(200);
    expect((await request(`/api/m/session/events/${event.id}/signup`, cookie, { friends: [] })).status).toBe(400);
    expect((await request("/api/auth/register", await session("other"), { username: "Alice", wechatNickname: "Alice" })).status).toBe(409);
    await env.DB.prepare("UPDATE members SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), m.id).run();
    expect((await request("/api/m/session/me", cookie)).status).toBe(403);
    expect((await request("/api/auth/register", cookie, { username: "Again", wechatNickname: "Again" })).status).toBe(409);
  });
  it("revokes a session on logout", async () => {
    const cookie = await session();
    expect((await request("/api/auth/logout", cookie, {})).status).toBe(200);
    expect((await (await request("/api/auth/session", cookie)).json() as any).signedIn).toBe(false);
  });
});
