import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendApplicationNotice } from "../src/worker/approvalEmail";
import { createMember } from "../src/worker/members";
import { MAX_AUTO_JOINS_PER_DAY } from "../src/shared/rules";
import { Client, GOOGLE, appoint, approveMember, googleJoin, request, setUpAdmin } from "./helpers";

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
    const { data } = await googleJoin("Dan", "dan_wx");
    expect(data.pending).toBe(true);
    expect((await memberRow(data.id)).status).toBe("pending");
  });

  it("lets Google applicants straight in, with no /m/ link, and logs it", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: true })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.autoJoin).toBe(true);
    expect((await new Client().call("/api/public/site")).data.autoJoin).toBe(true);

    const { status, data, cookie } = await googleJoin("Dan", "dan_wx", { email: "dan@gmail.com" });
    expect(status).toBe(200);
    expect(data.pending).toBe(false);
    const row = await memberRow(data.id);
    expect(row.status).toBe("active");
    expect(row.approved_at).toBeTruthy();
    expect(row.token_enc).toBeNull();
    expect((await json(await request("/api/auth/session", cookie))).data).toMatchObject({
      hasMember: true,
      pending: false,
    });
    expect((await json(await request("/api/m/session/me", cookie))).status).toBe(200);
    const { data: members } = await ctx.admin.call(`${ctx.base}/members`);
    expect(members.pending).toEqual([]);

    // One email is still one member.
    expect((await googleJoin("Dan2", "dan2_wx", { email: "dan@gmail.com" })).status).toBe(409);

    const { data: log } = await ctx.admin.call(`${ctx.base}/group-audit`);
    expect(log.entries.map((e: any) => [e.action, e.actor, e.detail])).toEqual(
      expect.arrayContaining([
        ["settings", "Jay", "修改设置：入群不需要审核 开"],
        ["auto_join", "Dan", "Dan 入群（入群不需要审核）"],
      ]),
    );

    await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: false });
    const { data: later } = await googleJoin("Eve", "eve_wx");
    expect(later.pending).toBe(true);
    expect((await memberRow(later.id)).status).toBe("pending");
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
    const { data } = await googleJoin("Dan", "dan_wx");
    expect(data.pending).toBe(true);
    expect((await memberRow(data.id)).status).toBe("pending");

    // A day later there is room again.
    await db
      .prepare("UPDATE group_audit SET at = ?")
      .bind(new Date(Date.now() - 86401_000).toISOString())
      .run();
    const { data: next } = await googleJoin("Eve", "eve_wx");
    expect(next.pending).toBe(false);
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
