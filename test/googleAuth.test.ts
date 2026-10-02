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
  it("registers a newcomer as 待审核: no sign-up until the Owner approves", async () => {
    const ctx = await setUpAdmin();
    const event = await createTestEvent(ctx);
    const cookie = await session();
    const reg = await request("/api/auth/register", cookie, { username: "Alice", wechatNickname: "Alice微信" });
    expect(reg.status).toBe(200);
    const { id } = await reg.json() as { id: string };

    // Waiting: the session says so, member pages and sign-up are closed, applying twice is refused.
    expect(await (await request("/api/auth/session", cookie)).json()).toMatchObject({ signedIn: true, hasMember: false, pending: true });
    const me = await request("/api/m/session/me", cookie);
    expect(me.status).toBe(403);
    expect((await me.json() as any).error.code).toBe("pending_approval");
    expect((await request(`/api/m/session/events/${event.id}/signup`, cookie, { friends: [] })).status).toBe(403);
    expect((await request("/api/auth/register", cookie, { username: "Other", wechatNickname: "Other" })).status).toBe(409);

    // The Owner sees who applied, Google email included, and approves.
    const pending = (await ctx.admin.call(`${ctx.base}/members`)).data.pending;
    expect(pending).toEqual([expect.objectContaining({ id, username: "Alice", googleEmail: "alice@gmail.com" })]);
    expect((await ctx.admin.call(`${ctx.base}/members/${id}/approve`, {})).status).toBe(200);

    expect(await (await request("/api/auth/session", cookie)).json()).toMatchObject({ hasMember: true, pending: false });
    expect(await (await request("/api/m/session/me", cookie)).json()).toMatchObject({ id, username: "Alice", active: true, isOwner: false });
    expect((await request(`/api/m/session/events/${event.id}/signup`, cookie, { friends: [] })).status).toBe(200);
    expect((await request(`${ctx.base}/members`, cookie)).status).toBe(401);
    expect((await request("/api/auth/register", cookie, { username: "Other", wechatNickname: "Other" })).status).toBe(409);
  });
  it("frees the Google account of a rejected applicant to apply again", async () => {
    const ctx = await setUpAdmin();
    const cookie = await session("google-bob");
    const { id } = await (await request("/api/auth/register", cookie, { username: "Bob", wechatNickname: "Bob" })).json() as { id: string };
    await ctx.admin.call(`${ctx.base}/members/${id}/reject`, {});
    expect(await (await request("/api/auth/session", cookie)).json()).toMatchObject({ hasMember: false, pending: false });
    expect((await request("/api/auth/register", cookie, { username: "Bob", wechatNickname: "Bob" })).status).toBe(200);
  });
  it("counts Google applications toward the 待审核 cap", async () => {
    await env.DB.prepare("DELETE FROM members WHERE status = 'pending'").run();
    for (let i = 0; i < 30; i++) await createMember(env, { username: `Wait${i}`, wechatNickname: "w", status: "pending" });
    const res = await request("/api/auth/register", await session("google-flood"), { username: "Flood", wechatNickname: "f" });
    expect(res.status).toBe(429);
    await env.DB.prepare("DELETE FROM members WHERE status = 'pending'").run();
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
    // A member deleted before deletions released the account (still holding google_sub) no longer
    // opens anything, and the person can apply again as someone new.
    await env.DB.prepare("UPDATE members SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), m.id).run();
    expect((await request("/api/m/session/me", cookie)).status).toBe(409);
    expect(await (await request("/api/auth/session", cookie)).json()).toMatchObject({ hasMember: false, pending: false });
    const again = await request("/api/auth/register", cookie, { username: "Again", wechatNickname: "Again" });
    expect(again.status).toBe(200);
    expect((await again.json() as { id: string }).id).not.toBe(m.id);
  });
  it("lets a deleted member's Google account apply again for a new member number, keeping the old record", async () => {
    const ctx = await setUpAdmin();
    const old = await createMember(env, { username: "Carol", wechatNickname: "Carol", status: "active", googleSub: "google-carol", googleEmail: "carol@gmail.com" });
    expect((await ctx.admin.call(`${ctx.base}/members/${old.id}/deactivate`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/members/${old.id}/delete`, {})).status).toBe(200);
    const row = await env.DB.prepare("SELECT google_sub, google_email, deleted_at FROM members WHERE id = ?").bind(old.id).first<Record<string, string | null>>();
    expect(row).toMatchObject({ google_sub: null, google_email: "carol@gmail.com" });
    expect(row!.deleted_at).not.toBeNull();

    const cookie = await session("google-carol");
    const res = await request("/api/auth/register", cookie, { username: "Carol2", wechatNickname: "Carol" });
    expect(res.status).toBe(200);
    const { id } = await res.json() as { id: string };
    expect(id).not.toBe(old.id);
    expect(Number(id.slice(1))).toBeGreaterThan(Number(old.id.slice(1)));
    expect((await ctx.admin.call(`${ctx.base}/members`)).data.pending).toEqual([expect.objectContaining({ id, googleEmail: "alice@gmail.com" })]);
  });
  it("revokes a session on logout", async () => {
    const cookie = await session();
    expect((await request("/api/auth/logout", cookie, {})).status).toBe(200);
    expect((await (await request("/api/auth/session", cookie)).json() as any).signedIn).toBe(false);
  });
});

describe("Google login for the admin", () => {
  const jay = () => session("google-jay");
  async function bindJay() {
    const ctx = await setUpAdmin();
    const google = await jay();
    const res = await request(`${ctx.base}/settings/google/bind`, `${ctx.admin.cookie}; ${google}`, {});
    expect(res.status).toBe(200);
    return { ctx, google };
  }

  it("opens /admin/google only for the Google account bound to the Owner", async () => {
    await setUpAdmin();
    expect((await request("/api/admin/google/members")).status).toBe(401);
    const res = await request("/api/admin/google/members", await jay());
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("google_admin_required");
  });

  it("binds the signed-in account from the admin page, then lets it in without link or password", async () => {
    const { ctx, google } = await bindJay();
    const members = await request("/api/admin/google/members", google);
    expect(members.status).toBe(200);
    expect(((await members.json()) as any).active[0]).toMatchObject({ isOwner: true });
    expect(await (await request("/api/auth/session", google)).json()).toMatchObject({ isAdmin: true, hasMember: true });
    expect(await (await request(`${ctx.base}/settings/google`, `${ctx.admin.cookie}; ${google}`)).json()).toMatchObject({
      bound: "alice@gmail.com",
      current: { isOwner: true, holder: null },
    });
    // The Owner's own sign-ups work through the same session.
    const e = await createTestEvent(ctx);
    expect((await request(`/api/admin/google/events/${e.id}/self-signup`, google, { friends: [] })).status).toBe(200);
    // Lax cookie: writes from another site are refused.
    expect((await request(`/api/admin/google/events/${e.id}/self-cancel`, google, {}, "https://evil.example")).status).toBe(403);
    // Someone else's Google account still can't get in.
    expect((await request("/api/admin/google/members", await session("google-alice"))).status).toBe(401);
  });

  it("keeps one Google account to one person", async () => {
    const ctx = await setUpAdmin();
    await createMember(env, { username: "Alice", wechatNickname: "Alice", status: "active", googleSub: "google-alice", googleEmail: "alice@gmail.com" });
    const alice = await session("google-alice");
    const taken = await request(`${ctx.base}/settings/google/bind`, `${ctx.admin.cookie}; ${alice}`, {});
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as any).error.message).toContain("Alice");
    expect(await (await request(`${ctx.base}/settings/google`, `${ctx.admin.cookie}; ${alice}`)).json()).toMatchObject({ bound: null, current: { holder: "Alice" } });
    // Alice's account stays a member's: it doesn't open the admin page.
    expect((await request("/api/admin/google/members", alice)).status).toBe(401);

    expect((await request(`${ctx.base}/settings/google/bind`, `${ctx.admin.cookie}; ${await jay()}`, {})).status).toBe(200);
    // Bound already: a second account needs an unbind first.
    expect((await request(`${ctx.base}/settings/google/bind`, `${ctx.admin.cookie}; ${await session("google-other")}`, {})).status).toBe(409);
  });

  it("unbinding shuts the Google way in; the link and password still work", async () => {
    const { ctx, google } = await bindJay();
    expect((await request("/api/admin/google/settings/google/unbind", google, {})).status).toBe(200);
    expect((await request("/api/admin/google/members", google)).status).toBe(401);
    expect((await request(`${ctx.base}/members`, ctx.admin.cookie)).status).toBe(200);
    expect(await (await request("/api/auth/session", google)).json()).toMatchObject({ isAdmin: false });
  });

  it("returns to the page that asked for Google, and only to this site's pages", async () => {
    for (const [next, landing] of <[string, string][]>[["/admin/google", "/admin/google"], ["//evil.example/x", "/me"], ["https://evil.example", "/me"]]) {
      const res = await request(`/api/auth/google?next=${encodeURIComponent(next)}`);
      const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
      const url = new URL(res.headers.get("Location")!);
      const token = await new SignJWT({ email: "jay@gmail.com", email_verified: true, nonce: url.searchParams.get("nonce") })
        .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setSubject("google-jay")
        .setIssuer("https://accounts.google.com").setAudience("test-client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
        String(input instanceof Request ? input.url : input).includes("certs") ? Response.json({ keys: [jwk] }) : Response.json({ id_token: token }));
      const back = await request(`/api/auth/google/callback?state=${url.searchParams.get("state")}&code=c`, cookies.join("; "));
      expect(back.headers.get("Location")).toBe(landing);
      vi.restoreAllMocks();
    }
  });
});
