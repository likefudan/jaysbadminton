import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, approveMember, createTestEvent, setUpAdmin, tokenOf } from "./helpers";

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

    const { ownerLink, admin, base } = await setUpAdmin();
    // Only the admin link: the Owner signs up from the admin page, not through a member link.
    expect(ownerLink).toBeUndefined();
    const owner = (await admin.call(`${base}/members`)).data.active.find((m: { isOwner: boolean }) => m.isOwner);
    expect(owner).toMatchObject({ username: "Jay", status: "active", hasLink: false });
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
    expect(me.data).toEqual({ id, username: "Dan", wechatNickname: "阿丹", isOwner: false, active: true });
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

  it("a disabled member keeps their link to pay but cannot sign up, and can be restored", async () => {
    const { token, id, admin, base } = await approvedMember();
    const e = await createTestEvent({ admin, base });
    await admin.call(`${base}/members/${id}/deactivate`, {});
    const me = await anon.call(`/api/m/${token}/me`);
    expect(me.data.active).toBe(false);
    expect((await anon.call(`/api/m/${token}/events/${e.id}/signup`, { friends: [] })).data.error.message).toContain("已停用");
    expect((await anon.call(`/api/m/${token}/events`)).data.events).toEqual([]); // only bills are shown
    expect((await admin.call(`${base}/members`)).data.inactive.map((m: { id: string }) => m.id)).toEqual([id]);

    expect((await admin.call(`${base}/members/${id}/reactivate`, {})).data).toEqual({ ok: true, link: null });
    expect((await anon.call(`/api/m/${token}/events/${e.id}/signup`, { friends: [] })).status).toBe(200);
  });

  it("restoring a member disabled under the old rules gives them a new link", async () => {
    const { id, admin, base } = await approvedMember();
    await admin.call(`${base}/members/${id}/deactivate`, {});
    await env.DB.prepare("UPDATE members SET token_hash = NULL, token_enc = NULL WHERE id = ?").bind(id).run();
    const { link } = (await admin.call(`${base}/members/${id}/reactivate`, {})).data;
    expect((await anon.call(`/api/m/${tokenOf(link)}/me`)).data.active).toBe(true);
  });

  it("deletes only disabled members who owe nothing, keeping them under 已删除", async () => {
    const { token, id, admin, base } = await approvedMember();
    expect((await admin.call(`${base}/members/${id}/delete`, {})).status).toBe(400); // still active
    await admin.call(`${base}/members/${id}/deactivate`, {});
    const e = await createTestEvent({ admin, base });
    await env.DB.prepare(
      "INSERT INTO payments (event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents) VALUES (?, ?, 1250, 'x', 'partial', 250)",
    )
      .bind(e.id, id)
      .run();
    expect((await admin.call(`${base}/members`)).data.inactive[0].owingCents).toBe(1000);
    expect((await admin.call(`${base}/members/${id}/delete`, {})).data.error.message).toContain("$10.00 没付清");

    await env.DB.prepare("UPDATE payments SET status = 'paid', amount_paid_cents = 1250").run();
    expect((await admin.call(`${base}/members/${id}/delete`, {})).status).toBe(200);
    expect((await anon.call(`/api/m/${token}/me`)).status).toBe(404);
    const list = (await admin.call(`${base}/members`)).data;
    expect(list.inactive).toEqual([]);
    expect(list.deleted.map((m: { id: string }) => m.id)).toEqual([id]);
    expect((await admin.call(`${base}/members/${id}/reactivate`, {})).status).toBe(400);
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

describe("default appearance", () => {
  it("defaults to 简约·珊瑚橙, accepts the eight looks and nothing else", async () => {
    expect((await anon.call("/api/public/site")).data.theme).toBe("minimal-coral");
    const { admin, base } = await setUpAdmin();
    expect((await admin.call(`${base}/settings`, { theme: "aurora-violet" })).status).toBe(200);
    expect((await anon.call("/api/public/site")).data.theme).toBe("aurora-violet");
    expect((await admin.call(`${base}/settings`, { theme: "lagoon" })).status).toBe(400);
    expect((await admin.call(`${base}/settings`, { theme: "aurora-coral" })).status).toBe(400);
  });

  it("maps a palette saved before styles existed to its nearest look", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'sakura')").run();
    expect((await anon.call("/api/public/site")).data.theme).toBe("aurora-sunset");
  });
});

describe("reset all data", () => {
  it("needs the phrase and the password, then returns the site to first-time setup", async () => {
    const ctx = await setUpAdmin();
    await approveMember(ctx, "Alice");
    await createTestEvent(ctx, { joinSelf: true });
    expect((await ctx.admin.call(`${ctx.base}/settings/reset`, { confirm: "清空", password: "initial-password" })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/settings/reset`, { confirm: "清空所有数据", password: "wrong" })).status).toBe(401);
    expect((await ctx.admin.call(`${ctx.base}/settings/reset`, { confirm: "清空所有数据", password: "initial-password" })).status).toBe(200);

    expect((await ctx.admin.call(`${ctx.base}/members`)).status).toBe(404);
    expect((await new Client().call("/api/public/admin-setup")).data).toEqual({ needed: true });
    expect((await new Client().call("/api/public/home")).data.currentEvents).toEqual([]);

    // The new Owner sets the site up again with the same password and starts at M001.
    const again = await new Client().call("/api/public/admin-setup", { password: "initial-password", username: "Ming", wechatNickname: "Ming" });
    expect(again.status).toBe(200);
    const members = (await new Client().call("/api/public/home")).status;
    expect(members).toBe(200);
    const { results } = await env.DB.prepare("SELECT id, username, is_owner FROM members").all();
    expect(results).toEqual([{ id: "M001", username: "Ming", is_owner: 1 }]);
  });
});

describe("links for disabled members", () => {
  it("lets the admin generate a link for a member disabled under the old rules, but never for a deleted one", async () => {
    const ctx = await setUpAdmin();
    const { id } = await approveMember(ctx, "Eve");
    await ctx.admin.call(`${ctx.base}/members/${id}/deactivate`, {});
    await env.DB.prepare("UPDATE members SET token_hash = NULL, token_enc = NULL WHERE id = ?").bind(id).run();
    expect((await ctx.admin.call(`${ctx.base}/members`)).data.inactive[0].hasLink).toBe(false);

    const { link } = (await ctx.admin.call(`${ctx.base}/members/${id}/regenerate`, {})).data;
    expect((await anon.call(`/api/m/${tokenOf(link)}/me`)).data).toMatchObject({ active: false });
    expect((await ctx.admin.call(`${ctx.base}/members`)).data.inactive[0].hasLink).toBe(true);

    await ctx.admin.call(`${ctx.base}/members/${id}/delete`, {});
    expect((await ctx.admin.call(`${ctx.base}/members/${id}/regenerate`, {})).status).toBe(400);
  });
});

describe("join form flood guard", () => {
  it("stops taking applications once 30 are waiting", async () => {
    await env.DB.batch(
      Array.from({ length: 30 }, (_, i) =>
        env.DB.prepare("INSERT INTO members (id, username, wechat_nickname, status, requested_at) VALUES (?, ?, 'x', 'pending', 'x')").bind(`P${i}`, `bot${i}`),
      ),
    );
    const res = await anon.call("/api/public/join", { username: "Real", wechatNickname: "Real" });
    expect(res.status).toBe(429);
    expect(res.data.error.message).toContain("待审核的申请太多");
  });
});
