import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, setUpAdmin, tokenOf } from "./helpers";

const anon = new Client();

describe("join requests", () => {
  it("assigns increasing member IDs that are never reused", async () => {
    const a = await anon.call("/api/public/join", { username: "Alice", wechatNickname: "爱丽丝" });
    const b = await anon.call("/api/public/join", { username: "Bob", wechatNickname: "小鲍" });
    expect(a.data.id).toBe("M001");
    expect(b.data.id).toBe("M002");

    const { admin, base } = await setUpAdmin(); // the Owner becomes M003
    await admin.call(`${base}/members/M002/reject`, {});
    const c = await anon.call("/api/public/join", { username: "Carol", wechatNickname: "卡罗" });
    expect(c.data.id).toBe("M004");
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    await anon.call("/api/public/join", { username: "Alice", wechatNickname: "a" });
    const dup = await anon.call("/api/public/join", { username: "alice", wechatNickname: "b" });
    expect(dup.status).toBe(409);
    expect(dup.data.error.message).toBe("这个用户名已被使用，请换一个");
  });

  it("validates fields with Chinese messages", async () => {
    const res = await anon.call("/api/public/join", { username: "  ", wechatNickname: "x" });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toBe("请填写用户名");
  });

  it("silently drops honeypot submissions", async () => {
    const res = await anon.call("/api/public/join", { username: "Bot", wechatNickname: "bot", website: "spam" });
    expect(res.data).toEqual({ ok: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first("n")).toBe(0);
  });
});

describe("admin setup and login", () => {
  it("is only available once and needs the password", async () => {
    const wrong = await new Client().call("/api/public/admin-setup", { password: "nope", username: "Jay", wechatNickname: "J" });
    expect(wrong.status).toBe(401);
    expect((await anon.call("/api/public/admin-setup")).data.needed).toBe(true);

    const { ownerLink } = await setUpAdmin();
    expect(ownerLink).toMatch(/\/m\/[\w-]{43}$/);
    expect((await anon.call("/api/public/admin-setup")).data.needed).toBe(false);
    const again = await new Client().call("/api/public/admin-setup", { password: "initial-password", username: "X", wechatNickname: "X" });
    expect(again.status).toBe(409);
  });

  it("requires both the admin link and a password session", async () => {
    const { base } = await setUpAdmin();
    const stranger = new Client();
    expect((await stranger.call("/api/admin/wrong-token/members")).status).toBe(404);
    expect((await stranger.call(`${base}/members`)).data.error.code).toBe("login_required");
    expect((await stranger.call(`${base}/login`, { password: "bad" })).status).toBe(401);
    expect((await stranger.call(`${base}/login`, { password: "initial-password" })).status).toBe(200);
    expect((await stranger.call(`${base}/members`)).status).toBe(200);
  });

  it("changing the password signs every device out", async () => {
    const { admin, base } = await setUpAdmin();
    const short = await admin.call(`${base}/settings/password`, { current: "initial-password", next: "short" });
    expect(short.data.error.message).toBe("密码至少 8 位");
    await admin.call(`${base}/settings/password`, { current: "initial-password", next: "new-password-1" });
    expect((await admin.call(`${base}/members`)).status).toBe(401);
    expect((await admin.call(`${base}/login`, { password: "initial-password" })).status).toBe(401);
    expect((await admin.call(`${base}/login`, { password: "new-password-1" })).status).toBe(200);
  });

  it("a changed ADMIN_PASSWORD secret resets the password and sessions", async () => {
    const { admin, base } = await setUpAdmin();
    await admin.call(`${base}/settings/password`, { current: "initial-password", next: "new-password-1" });
    // Simulate the stored fingerprint belonging to an older secret value.
    await env.DB.prepare("UPDATE settings SET value = 'old' WHERE key = 'admin_password_env_fp'").run();
    expect((await admin.call(`${base}/login`, { password: "new-password-1" })).status).toBe(401);
    expect((await admin.call(`${base}/login`, { password: "initial-password" })).status).toBe(200);
  });

  it("locks password checks for 15 minutes after 5 wrong attempts", async () => {
    const { base } = await setUpAdmin();
    const c = new Client();
    for (let i = 0; i < 5; i++) expect((await c.call(`${base}/login`, { password: "bad" })).status).toBe(401);
    const locked = await c.call(`${base}/login`, { password: "initial-password" });
    expect(locked.status).toBe(429);
    expect(locked.data.error.message).toBe("密码错误次数过多，请 15 分钟后再试");
  });

  it("rotating the admin link kills the old one", async () => {
    const { admin, base } = await setUpAdmin();
    const { data } = await admin.call(`${base}/settings/rotate-admin`, {});
    expect((await admin.call(`${base}/members`)).status).toBe(404);
    expect((await admin.call(`/api/admin/${tokenOf(data.link)}/members`)).status).toBe(200);
  });
});

describe("member links", () => {
  async function approvedMember() {
    const ctx = await setUpAdmin();
    const { data: joined } = await anon.call("/api/public/join", { username: "Dan", wechatNickname: "阿丹" });
    const { data } = await ctx.admin.call(`${ctx.base}/members/${joined.id}/approve`, {});
    return { ...ctx, id: joined.id as string, token: tokenOf(data.link) };
  }

  it("approval issues a link the member can use; pending members have none", async () => {
    const { token, id, admin, base } = await approvedMember();
    const me = await anon.call(`/api/m/${token}/me`);
    expect(me.data).toEqual({ id, username: "Dan", wechatNickname: "阿丹", isOwner: false });
    const shown = await admin.call(`${base}/members/${id}/link`);
    expect(tokenOf(shown.data.link)).toBe(token);
  });

  it("stores only a hash and ciphertext, never the raw token", async () => {
    const { token, id } = await approvedMember();
    const row = await env.DB.prepare("SELECT token_hash, token_enc FROM members WHERE id = ?").bind(id).first<Record<string, string>>();
    expect(row!.token_hash).not.toContain(token);
    expect(row!.token_enc).not.toContain(token);
  });

  it("regenerating invalidates the old link", async () => {
    const { token, id, admin, base } = await approvedMember();
    const { data } = await admin.call(`${base}/members/${id}/regenerate`, {});
    expect((await anon.call(`/api/m/${token}/me`)).status).toBe(404);
    expect((await anon.call(`/api/m/${tokenOf(data.link)}/me`)).status).toBe(200);
  });

  it("deactivating kills the link but keeps the member", async () => {
    const { token, id, admin, base } = await approvedMember();
    await admin.call(`${base}/members/${id}/deactivate`, {});
    expect((await anon.call(`/api/m/${token}/me`)).status).toBe(404);
    const list = await admin.call(`${base}/members`);
    expect(list.data.inactive.map((m: { id: string }) => m.id)).toEqual([id]);
  });

  it("members can rename themselves, keeping names unique", async () => {
    const { token } = await approvedMember();
    expect((await anon.call(`/api/m/${token}/rename`, { username: "jay" })).status).toBe(409);
    expect((await anon.call(`/api/m/${token}/rename`, { username: "Danny" })).status).toBe(200);
    expect((await anon.call(`/api/m/${token}/me`)).data.username).toBe("Danny");
  });
});

describe("site title", () => {
  it("defaults to Jay's 羽毛球 and can be changed by the Owner", async () => {
    expect((await anon.call("/api/public/site")).data.title).toBe("Jay's 羽毛球");
    const { admin, base } = await setUpAdmin();
    const empty = await admin.call(`${base}/settings`, { siteTitle: "  " });
    expect(empty.data.error.message).toBe("请填写网站标题");
    await admin.call(`${base}/settings`, { siteTitle: "周二羽毛球" });
    expect((await anon.call("/api/public/site")).data.title).toBe("周二羽毛球");
    expect((await admin.call(`${base}/settings`)).data.siteTitle).toBe("周二羽毛球");
  });
});
