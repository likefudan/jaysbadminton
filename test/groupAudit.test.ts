import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, appoint, approveMember, createTestEvent, GOOGLE, joinBody, request, setUpAdmin } from "./helpers";

/** 管理员 PR 5: 群操作记录 (admin-role.zh.md §7). */

const db = env.DB;

/** Owner Jay, admin Carol, organizer Alice, member Bob. */
async function scenario() {
  const ctx = await setUpAdmin();
  const carol = await approveMember(ctx, "Carol");
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const admin = await appoint(carol.id, "carol", "admin");
  const org = await appoint(alice.id, "alice");
  await db.prepare("DELETE FROM group_audit").run();
  const call = async (cookie: string, base: string, path: string, body?: unknown) => {
    const res = await request(`${base}${path}`, cookie, body);
    const text = await res.text();
    return { status: res.status, data: text.startsWith("{") ? JSON.parse(text) : text };
  };
  const owner = (path: string, body?: unknown) => call(ctx.admin.cookie, ctx.base, path, body);
  const asAdmin = (path: string, body?: unknown) => call(admin, GOOGLE, path, body);
  const log = async () => ((await owner("/group-audit")).data.entries as { actor: string; detail: string }[]).reverse();
  return { ctx, carol, alice, bob, admin, org, owner, asAdmin, log };
}

describe("群操作记录", () => {
  it("records member actions by name, whoever did them", async () => {
    const { bob, owner, asAdmin, log } = await scenario();
    const { data: joined } = await new Client().call("/api/public/join", joinBody("Dan", "dan_wx"));
    expect((await asAdmin(`/members/${joined.id}/approve`, {})).status).toBe(200);
    const { data: other } = await new Client().call("/api/public/join", joinBody("Eve", "eve_wx"));
    expect((await asAdmin(`/members/${other.id}/reject`, {})).status).toBe(200);
    await asAdmin(`/members/${bob.id}/note`, { note: "周六队长" });
    await asAdmin(`/members/${bob.id}/note`, { note: "周六队长" }); // unchanged: nothing recorded
    await asAdmin(`/members/${bob.id}/regenerate`, {});
    await asAdmin(`/members/${bob.id}/deactivate`, {});
    await asAdmin(`/members/${bob.id}/deactivate`, {}); // second click: nothing more
    await asAdmin(`/members/${bob.id}/reactivate`, {});
    await asAdmin(`/members/${bob.id}/deactivate`, {});
    expect((await owner(`/members/${bob.id}/delete`, {})).status).toBe(200);
    await owner(`/members/${bob.id}/delete`, {}); // second click: nothing more
    expect(await log()).toEqual([
      {
        id: expect.any(Number),
        at: expect.any(String),
        action: "approve",
        actor: "Carol",
        detail: "通过 Dan 的入群申请",
      },
      {
        id: expect.any(Number),
        at: expect.any(String),
        action: "reject",
        actor: "Carol",
        detail: "拒绝 Eve 的入群申请",
      },
      {
        id: expect.any(Number),
        at: expect.any(String),
        action: "note",
        actor: "Carol",
        detail: "把 Bob 的备注名改为「周六队长」",
      },
      {
        id: expect.any(Number),
        at: expect.any(String),
        action: "link_regen",
        actor: "Carol",
        detail: "重新生成 Bob 的专属链接",
      },
      { id: expect.any(Number), at: expect.any(String), action: "deactivate", actor: "Carol", detail: "停用 Bob" },
      { id: expect.any(Number), at: expect.any(String), action: "reactivate", actor: "Carol", detail: "恢复 Bob" },
      { id: expect.any(Number), at: expect.any(String), action: "deactivate", actor: "Carol", detail: "停用 Bob" },
      { id: expect.any(Number), at: expect.any(String), action: "delete", actor: "Jay", detail: "删除成员 Bob" },
    ]);
  });

  it("records appointments, settings, exports and transfers", async () => {
    const { ctx, bob, alice, carol, org, owner, asAdmin, log } = await scenario();
    await db
      .prepare("UPDATE members SET google_sub = 'g-bob', google_email = 'bob@example.com' WHERE id = ?")
      .bind(bob.id)
      .run();
    await asAdmin(`/members/${bob.id}/appoint`, {});
    await asAdmin(`/members/${bob.id}/revoke`, {});
    await owner(`/members/${alice.id}/appoint-admin`, {});
    await owner(`/members/${alice.id}/demote-admin`, {});
    await owner(`/members/${carol.id}/revoke`, {});
    expect((await request(`${GOOGLE}/organizer/retire`, org, {})).status).toBe(200);
    await owner("/settings", { friendCap: 3, showLeaderboard: false });
    await owner("/export/members.csv");
    await owner("/sheets/enable", {});
    const e = await createTestEvent(ctx);
    await owner(`/members/${bob.id}/appoint`, {});
    await owner(`/events/${e.id}/transfer`, { to: bob.id });
    const details = (await log()).map((r) => `${r.actor}: ${r.detail}`);
    expect(details.slice(0, 10)).toEqual([
      "Carol: 任命 Bob 为组织者",
      "Carol: 撤销 Bob 的组织者身份",
      "Jay: 把 Alice 从组织者升为管理员",
      "Jay: 把 Alice 从管理员降为组织者",
      "Jay: 撤销 Carol 的管理员身份",
      "Alice: Alice 不再当组织者",
      "Jay: 修改设置：带朋友上限 3，排行榜 关",
      "Jay: 导出「成员」",
      "Jay: 开启 Google 表格同步（生成新的同步密钥）",
      "Jay: 任命 Bob 为组织者",
    ]);
    expect(details[10]).toMatch(/^Jay: 把活动 .+（.+） 从 Jay 转交给 Bob，收款人一起换$/);
  });

  it("is for the Owner and admins, a page at a time, and goes with 清空所有数据", async () => {
    const { ctx, org, owner, asAdmin } = await scenario();
    expect((await request(`${GOOGLE}/group-audit`, org)).status).toBe(403);
    for (let i = 0; i < 35; i++)
      await db
        .prepare("INSERT INTO group_audit (actor_id, action, detail, at) VALUES ('owner', 'settings', ?, ?)")
        .bind(`第 ${i} 条`, new Date().toISOString())
        .run();
    const first = (await asAdmin("/group-audit")).data;
    expect(first.entries).toHaveLength(30);
    expect(first.entries[0].detail).toBe("第 34 条");
    expect(first.more).toBe(true);
    const second = (await asAdmin(`/group-audit?before=${first.entries[29].id}`)).data;
    expect(second.entries.map((r: { detail: string }) => r.detail)).toEqual([
      "第 4 条",
      "第 3 条",
      "第 2 条",
      "第 1 条",
      "第 0 条",
    ]);
    expect(second.more).toBe(false);
    expect((await owner("/settings/reset", { confirm: "清空所有数据", password: "initial-password" })).status).toBe(
      200,
    );
    expect(await db.prepare("SELECT COUNT(*) AS n FROM group_audit").first()).toEqual({ n: 0 });
    void ctx;
  });
});
