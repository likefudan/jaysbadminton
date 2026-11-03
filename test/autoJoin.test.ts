import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendApplicationNotice } from "../src/worker/approvalEmail";
import { createMember } from "../src/worker/members";
import { MAX_AUTO_JOINS_PER_DAY } from "../src/shared/rules";
import { Client, GOOGLE, appoint, approveMember, googleCookie, joinBody, request, setUpAdmin } from "./helpers";

/** 入群不需要审核 (Ke Li 2026-11-03). */

const db = env.DB;
afterEach(() => vi.restoreAllMocks());

const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });
const memberRow = (id: string) =>
  db.prepare("SELECT status, approved_at, token_enc FROM members WHERE id = ?").bind(id).first<any>();

describe("入群不需要审核", () => {
  it("is off by default: applications wait in 待审核", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.autoJoin).toBe(false);
    expect((await new Client().call("/api/public/site")).data.autoJoin).toBe(false);
    const { data } = await new Client().call("/api/public/join", joinBody("Dan", "dan_wx"));
    expect(data.approved).toBe(false);
    expect((await memberRow(data.id)).status).toBe("pending");
  });

  it("lets email applicants straight in, with a link of their own, and logs it", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: true })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.autoJoin).toBe(true);
    expect((await new Client().call("/api/public/site")).data.autoJoin).toBe(true);

    const body = joinBody("Dan", "dan_wx");
    const { status, data } = await new Client().call("/api/public/join", body);
    expect(status).toBe(200);
    // The test worker has no Resend key, so the welcome email reports that.
    expect(data).toMatchObject({ approved: true, emailStatus: "not_configured" });
    const row = await memberRow(data.id);
    expect(row.status).toBe("active");
    expect(row.approved_at).toBeTruthy();
    expect(row.token_enc).toBeTruthy();
    const { data: members } = await ctx.admin.call(`${ctx.base}/members`);
    expect(members.pending).toEqual([]);

    // One email is still one member.
    const again = await new Client().call("/api/public/join", { ...joinBody("Dan2", "dan2_wx"), ...pick(body) });
    expect(again.status).toBe(409);

    const { data: log } = await ctx.admin.call(`${ctx.base}/group-audit`);
    expect(log.entries.map((e: any) => [e.action, e.actor, e.detail])).toEqual(
      expect.arrayContaining([
        ["settings", "Jay", "修改设置：入群不需要审核 开"],
        ["auto_join", "Dan", "Dan 入群（入群不需要审核）"],
      ]),
    );

    await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: false });
    const { data: later } = await new Client().call("/api/public/join", joinBody("Eve", "eve_wx"));
    expect(later.approved).toBe(false);
    expect((await memberRow(later.id)).status).toBe("pending");
  });

  it("lets Google applicants straight in", async () => {
    await setUpAdmin();
    await db.prepare("INSERT INTO settings (key, value) VALUES ('auto_join', '1')").run();
    const cookie = await googleCookie("google-dan", "dan@gmail.com");
    const reg = await json(await request("/api/auth/register", cookie, { username: "Dan", wechatNickname: "dan_wx" }));
    expect(reg).toMatchObject({ status: 200, data: { pending: false } });
    expect((await json(await request("/api/auth/session", cookie))).data).toMatchObject({
      hasMember: true,
      pending: false,
    });
    expect((await json(await request("/api/m/session/me", cookie))).status).toBe(200);
  });

  it("falls back to 待审核 after a day's worth of automatic joins", async () => {
    await setUpAdmin();
    await db.prepare("INSERT INTO settings (key, value) VALUES ('auto_join', '1')").run();
    const at = new Date().toISOString();
    await db.batch(
      Array.from({ length: MAX_AUTO_JOINS_PER_DAY }, () =>
        db
          .prepare(
            "INSERT INTO group_audit (actor_id, target_id, action, detail, at) VALUES ('X', 'X', 'auto_join', '', ?)",
          )
          .bind(at),
      ),
    );
    const { data } = await new Client().call("/api/public/join", joinBody("Dan", "dan_wx"));
    expect(data.approved).toBe(false);
    expect((await memberRow(data.id)).status).toBe("pending");

    // A day later there is room again.
    await db
      .prepare("UPDATE group_audit SET at = ?")
      .bind(new Date(Date.now() - 86401_000).toISOString())
      .run();
    const { data: next } = await new Client().call("/api/public/join", joinBody("Eve", "eve_wx"));
    expect(next.approved).toBe(true);
  });

  it("admins may switch it; organizers may not", async () => {
    const ctx = await setUpAdmin();
    const carol = await approveMember(ctx, "Carol");
    const alice = await approveMember(ctx, "Alice");
    const admin = await appoint(carol.id, "carol", "admin");
    const org = await appoint(alice.id, "alice");
    expect((await request(`${GOOGLE}/settings`, admin, { autoJoin: true })).status).toBe(200);
    expect((await db.prepare("SELECT value FROM settings WHERE key = 'auto_join'").first<any>()).value).toBe("1");
    expect((await request(`${GOOGLE}/settings`, org, { autoJoin: false })).status).toBe(403);
    expect((await db.prepare("SELECT value FROM settings WHERE key = 'auto_join'").first<any>()).value).toBe("1");
  });

  it("tells the Owner someone joined rather than asking for a review", async () => {
    const m = await createMember(env, {
      username: "Dan",
      wechatNickname: "dan_wx",
      status: "active",
      email: "dan@example.com",
    });
    await db.prepare("INSERT INTO settings (key,value) VALUES ('telegram_chat_id','owner-chat')").run();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    expect(await sendApplicationNotice({ ...env, TELEGRAM_BOT_TOKEN: "test-bot" }, m, true)).toBe(true);
    const { text } = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(text).toContain("新成员已入群（入群不需要审核）");
    expect(text).toContain("用户名：Dan");
    expect(text).toContain("「成员」里停用");
    expect(text).not.toContain("待审核」处理");
  });
});

const pick = (b: { email: string; emailConfirm: string }) => ({ email: b.email, emailConfirm: b.emailConfirm });
