import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../src/worker/index";
import { createMember } from "../src/worker/members";
import { setPassword } from "../src/worker/auth";
const ORIGIN = "https://staging.jaysbadminton.test";
const request = (path: string, body?: unknown, cookie = "", staging = true, origin = ORIGIN) =>
  worker.fetch(
    new Request(ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ENVIRONMENT: staging ? "staging" : "production" },
    {} as ExecutionContext,
  );
async function login() {
  const res = await request("/api/developer/login", { password: "initial-password" });
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(res.headers.get("Set-Cookie")).toContain("SameSite=Strict");
  return res.headers.get("Set-Cookie")!.match(/jb_developer=[^; ,]+/)![0];
}
it("grants staging admin access and an ordinary non-owner member, then revokes both on logout", async () => {
  const cookie = await login();
  expect((await request("/api/admin/developer/members", undefined, cookie)).status).toBe(200);
  const me = await request("/api/m/session/me", undefined, cookie);
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ isOwner: false, active: true });
  expect((await request("/api/admin/google/members", undefined, cookie)).status).toBe(401);
  expect((await request("/api/developer/logout", {}, cookie)).status).toBe(200);
  expect((await request("/api/admin/developer/members", undefined, cookie)).status).toBe(401);
  expect((await request("/api/m/session/me", undefined, cookie)).status).toBe(401);
});
it("never exposes developer authentication or permissions in production, even with a valid staging cookie", async () => {
  const cookie = await login();
  for (const path of ["/api/developer/session", "/api/admin/developer/members"])
    expect((await request(path, undefined, cookie, false)).status).toBe(404);
  expect((await request("/api/developer/login", { password: "initial-password" }, "", false)).status).toBe(404);
  expect((await request("/api/m/session/me", undefined, cookie, false)).status).toBe(401);
});
it("rejects incorrect passwords, forged cookies, cross-origin writes and expired sessions", async () => {
  expect((await request("/api/developer/login", { password: "wrong" })).status).toBe(401);
  expect(
    (await request("/api/developer/login", { password: "initial-password" }, "", true, "https://evil.test")).status,
  ).toBe(403);
  expect((await request("/api/admin/developer/members", undefined, "jb_developer=forged")).status).toBe(401);
  const cookie = await login();
  expect(
    (await request("/api/admin/developer/members/M001/deactivate", {}, cookie, true, "https://evil.test")).status,
  ).toBe(403);
  await env.DB.prepare("UPDATE admin_sessions SET expires_at = '2000-01-01'").run();
  expect((await request("/api/developer/session", undefined, cookie)).status).toBe(200);
  expect(await (await request("/api/developer/session", undefined, cookie)).json()).toEqual({ signedIn: false });
});
it("reuses the dedicated test member without altering other members and revokes access when the password changes", async () => {
  const original = await createMember(env, { username: "Existing", wechatNickname: "Existing", status: "active" });
  const first = await login();
  const id = ((await (await request("/api/m/session/me", undefined, first)).json()) as any).id;
  const second = await login();
  expect(((await (await request("/api/m/session/me", undefined, second)).json()) as any).id).toBe(id);
  expect(await env.DB.prepare("SELECT status, is_owner FROM members WHERE id = ?").bind(original.id).first()).toEqual({
    status: "active",
    is_owner: 0,
  });
  await setPassword(env, "new-password");
  expect((await request("/api/admin/developer/members", undefined, second)).status).toBe(401);
});
