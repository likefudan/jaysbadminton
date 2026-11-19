import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { AI_DAILY_CAP_DEFAULT } from "../src/shared/ai";
import { assertAiBudget } from "../src/worker/ai";
import { eraseOldDeleted } from "../src/worker/erase";
import {
  Client,
  approveMember,
  createTestEvent,
  expire,
  googleCookie,
  googleJoin,
  request,
  setUpAdmin,
} from "./helpers";

const anon = new Client();
const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });
const member = (id: string) => env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<any>();
const count = async (sql: string, ...args: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...args)
      .first<{ n: number }>()
  )?.n;

describe("删除成员 (Ke Li 2026-11-18: 删了就全删)", () => {
  it("leaves nothing about the person, only their place on old lists", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const e = await createTestEvent(ctx);
    await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: ["Tom"] });
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    await expire(e.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, {
      courtTotal: "0",
      shuttleCount: 0,
      shuttlePrice: "0",
    });
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/note`, { note: "周六队长" });
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE members SET google_sub = 'g-alice', google_email = 'alice@gmail.com', wechat_account = 'alice_wx', application_message = '你好' WHERE id = ?",
      ).bind(alice.id),
      env.DB.prepare("INSERT INTO calories (event_id, member_id, kcal, recorded_at) VALUES (?, ?, 300, ?)").bind(
        e.id,
        alice.id,
        at,
      ),
      env.DB.prepare("INSERT INTO likes (event_id, from_member, to_member, created_at) VALUES (?, ?, ?, ?)").bind(
        e.id,
        alice.id,
        bob.id,
        at,
      ),
      env.DB.prepare("INSERT INTO likes (event_id, from_member, to_member, created_at) VALUES (?, ?, ?, ?)").bind(
        e.id,
        bob.id,
        alice.id,
        at,
      ),
    ]);

    await ctx.admin.call(`${ctx.base}/members/${alice.id}/deactivate`, {});
    expect((await ctx.admin.call(`${ctx.base}/members/${alice.id}/delete`, {})).status).toBe(200);

    const row = await member(alice.id);
    expect(row).toMatchObject({
      username: `已删除成员（${alice.id}）`,
      wechat_nickname: "",
      status: "inactive",
      google_sub: null,
      google_email: null,
      email: null,
      wechat_account: null,
      application_message: null,
      admin_note: null,
      token_hash: null,
    });
    expect(row.deleted_at).toBeTruthy();
    expect(await count("SELECT COUNT(*) AS n FROM calories WHERE member_id = ?", alice.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM likes WHERE from_member = ?1 OR to_member = ?1", alice.id)).toBe(0);
    // Rows the accounts need stay.
    expect(await count("SELECT COUNT(*) AS n FROM registrations WHERE member_id = ?", alice.id)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM group_audit WHERE detail LIKE '%Alice%'")).toBe(0);
    expect((await anon.call(`${alice.base}/me`)).status).not.toBe(200);
  });
});

describe("members deleted before 2026-11-18", () => {
  it("lose what the old delete kept, on the next cron", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/note`, { note: "周六队长" });
    // As the old delete left them.
    await env.DB.prepare(
      "UPDATE members SET deleted_at = '2026-10-01T00:00:00.000Z', status = 'inactive', token_hash = NULL, token_enc = NULL, username = ?, google_email = 'alice@gmail.com' WHERE id = ?",
    )
      .bind(`Alice（${alice.id}）`, alice.id)
      .run();
    await eraseOldDeleted(env);
    expect(await member(alice.id)).toMatchObject({
      username: `已删除成员（${alice.id}）`,
      deleted_at: "2026-10-01T00:00:00.000Z",
      google_email: null,
      email: null,
      admin_note: null,
      wechat_nickname: "",
    });
    expect(await count("SELECT COUNT(*) AS n FROM group_audit WHERE detail LIKE '%Alice%'")).toBe(0);
    // Nothing left to do the second time.
    await eraseOldDeleted(env);
    expect((await member(alice.id)).username).toBe(`已删除成员（${alice.id}）`);
  });
});

describe("删除账号 by the member", () => {
  it("needs the confirmation, then deletes everything and ends the sign-in", async () => {
    const ctx = await setUpAdmin();
    await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: true });
    const dan = await googleJoin("Dan", "dan_wx", { email: "dan@gmail.com" });
    expect(dan.status).toBe(200);
    const id = dan.data.id as string;

    expect((await json(await request("/api/m/session/account/delete", dan.cookie, {}))).status).toBe(400);
    expect((await member(id)).deleted_at).toBeNull();

    expect((await json(await request("/api/m/session/account/delete", dan.cookie, { confirm: true }))).status).toBe(
      200,
    );
    const row = await member(id);
    expect(row.username).toBe(`已删除成员（${id}）`);
    expect(row.google_email).toBeNull();
    expect((await json(await request("/api/m/session/me", dan.cookie))).status).not.toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM member_sessions")).toBe(0);
    const { data: log } = await ctx.admin.call(`${ctx.base}/group-audit`);
    expect(log.entries[0]).toMatchObject({ action: "delete", detail: `已删除成员（${id}） 自己删除了账号` });

    // The same email can apply again, as a new member.
    const back = await googleJoin("Dan", "dan_wx", { email: "dan@gmail.com" });
    expect(back.status).toBe(200);
    expect(back.data.id).not.toBe(id);
  });

  it("is refused while they are on a list that isn't settled, owe money, or run the group", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const e = await createTestEvent(ctx);
    await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: [] });
    const onList = await anon.call(`${alice.base}/account/delete`, { confirm: true });
    expect(onList.status).toBe(400);
    expect(onList.data.error.message).toContain("活动的名单上");

    await expire(e.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, {
      courtTotal: "10",
      shuttleCount: 0,
      shuttlePrice: "0",
    });
    const owing = await anon.call(`${alice.base}/account/delete`, { confirm: true });
    expect(owing.status).toBe(400);
    expect((await member(alice.id)).deleted_at).toBeNull();

    const owner = await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>();
    await env.DB.prepare("UPDATE members SET google_sub = 'g-owner', google_email = 'o@gmail.com' WHERE id = ?")
      .bind(owner!.id)
      .run();
    const refused = await json(
      await request("/api/m/session/account/delete", await googleCookie("g-owner", "o@gmail.com"), { confirm: true }),
    );
    expect(refused.status).toBe(400);
    expect((await member(owner!.id)).deleted_at).toBeNull();
  });
});

describe("清空所有数据", () => {
  it("works when a member has their own avatar (member_avatars points at members)", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await env.DB.prepare("INSERT INTO member_avatars (id, member_id, image, created_at) VALUES ('a1', ?, x'00', ?)")
      .bind(alice.id, new Date().toISOString())
      .run();
    const reset = await ctx.admin.call(`${ctx.base}/settings/reset`, {
      confirm: "清空所有数据",
      password: "initial-password",
    });
    expect(reset.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM member_avatars")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM members")).toBe(0);
  });
});

describe("AI 每天上限", () => {
  it("is 200 until changed, counts today's photos and refuses the next one at the cap", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.aiDaily).toEqual({ cap: AI_DAILY_CAP_DEFAULT, used: 0 });
    expect((await ctx.admin.call(`${ctx.base}/settings`, { aiDailyCap: 0 })).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/settings`, { aiDailyCap: 2 })).status).toBe(200);

    const use = (request: string, at: string) =>
      env.DB.prepare(
        `INSERT INTO ai_usage (request, use, event_id, model, effort, input_tokens, output_tokens, ok, created_at)
         VALUES (?, 'photo', NULL, 'm', 'low', 1, 1, 1, ?)`,
      ).bind(request, at);
    const today = new Date().toISOString();
    // One photo (two calls: the pick, then the fallback), and one from last week.
    await env.DB.batch([use("r1", today), use("r1", today), use("old", "2026-01-01T00:00:00Z")]);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.aiDaily).toEqual({ cap: 2, used: 1 });

    await use("r2", today).run();
    await expect(assertAiBudget(env)).rejects.toThrow("每天最多 2 次");
    await ctx.admin.call(`${ctx.base}/settings`, { aiDailyCap: 3 });
    await expect(assertAiBudget(env)).resolves.toBeUndefined();
  });
});

describe("球馆账号密码 for members nobody approved (Ke Li 2026-11-18)", () => {
  it("are hidden from someone who let themselves in until they have played once", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { queueRoundMin: 45 });
    const alice = await approveMember(ctx, "Alice");
    await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: [] });
    const added = await anon.call(`${alice.base}/events/${e.id}/queue/accounts`, { username: "gym1", password: "pw1" });
    expect(added.status).toBe(200);

    await ctx.admin.call(`${ctx.base}/settings`, { autoJoin: true });
    const dan = await googleJoin("Dan", "dan_wx");
    const call = async (path: string, body?: unknown) => json(await request(`/api/m/session${path}`, dan.cookie, body));
    expect((await call(`/events/${e.id}/signup`, { friends: [] })).status).toBe(200);
    const mine = await call(`/events/${e.id}/queue/accounts`, { username: "gym2", password: "pw2" });
    expect(mine.status).toBe(200);

    const queue = async () => (await call(`/events/${e.id}`)).data.event.queue;
    let q = await queue();
    expect(q.locked).toBe(true);
    expect(q.photo).toBe(false);
    const pw = (list: any[]) => Object.fromEntries(list.map((a) => [a.username, a.password]));
    // Their own stays readable; the approved member sees both.
    expect(pw(q.accounts)).toEqual({ gym1: "", gym2: "pw2" });
    expect((await call(`/events/${e.id}/queue/photo`, { image: "x" })).status).toBe(400);
    const seen = (await anon.call(`${alice.base}/events/${e.id}`)).data.event.queue;
    expect(seen.locked).toBe(false);
    expect(pw(seen.accounts)).toEqual({ gym1: "pw1", gym2: "pw2" });

    // Played once: an earlier event of theirs is settled.
    const past = await createTestEvent(ctx);
    await call(`/events/${past.id}/signup`, { friends: [] });
    await expire(past.id);
    await ctx.admin.call(`${ctx.base}/events/${past.id}/finalize`, {
      courtTotal: "0",
      shuttleCount: 0,
      shuttlePrice: "0",
    });
    q = await queue();
    expect(q.locked).toBe(false);
    expect(pw(q.accounts)).toEqual({ gym1: "pw1", gym2: "pw2" });
  });
});

describe("已停用 members", () => {
  it("can no longer rename, change their photo or cheer, but still see their page", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/deactivate`, {});
    expect((await anon.call(`${alice.base}/me`)).status).toBe(200);
    for (const [path, body] of [
      ["/rename", { username: "Alice2" }],
      ["/avatar/mode", { mode: "none" }],
      ["/lottery/cheer", { n: 1 }],
      ["/calories/board", { on: true }],
    ] as const) {
      const res = await anon.call(`${alice.base}${path}`, body);
      expect([path, res.status]).toEqual([path, 400]);
      expect(res.data.error.message).toContain("已停用");
    }
    expect((await member(alice.id)).username).toBe("Alice");
    // Back in the group: allowed again.
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/reactivate`, {});
    expect((await anon.call(`${alice.base}/rename`, { username: "Alice2" })).status).toBe(200);
  });
});
