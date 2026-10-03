import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TABLES } from "../src/worker/export";
import { purgeDeletedInbound } from "../src/worker/inbound";
import { setUpAdmin } from "./helpers";

const add = async (txn: string, state = "open") =>
  (await env.DB.prepare(
    `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, received_at, kind, state, reason)
     VALUES (?, 'Tester', 100, ?, 'unmatched', ?, '这次活动还没结算') RETURNING id`,
  )
    .bind(txn, new Date().toISOString(), state)
    .first<{ id: number }>())!.id;

describe("已删除 Venmo payments", () => {
  it("deletes, restores to where it came from, and deletes for good", async () => {
    const ctx = await setUpAdmin();
    const list = async () => (await ctx.admin.call(`${ctx.base}/inbound`)).data;
    const pending = await add("A1");
    const ignored = await add("A2", "ignored");
    const linked = await add("A3", "linked");

    for (const id of [pending, ignored])
      expect((await ctx.admin.call(`${ctx.base}/inbound/${id}/delete`, {})).status).toBe(200);
    const refused = await ctx.admin.call(`${ctx.base}/inbound/${linked}/delete`, {});
    expect(refused.data.error.message).toBe("只能删除待确认或已忽略的收款；已关联的请在账单里撤销");
    let d = await list();
    expect(d.open).toEqual([]);
    expect(d.done.map((i: { id: number }) => i.id)).toEqual([linked]);
    expect(d.deleted.map((i: { id: number }) => i.id).sort()).toEqual([pending, ignored].sort());
    expect(d.deleted[0].deletedAt).toBeTruthy();

    await ctx.admin.call(`${ctx.base}/inbound/${pending}/restore`, {});
    await ctx.admin.call(`${ctx.base}/inbound/${ignored}/restore`, {});
    d = await list();
    expect(d.open).toMatchObject([{ id: pending, state: "open", deletedAt: null }]);
    expect(d.ignored).toMatchObject([{ id: ignored, state: "ignored" }]);
    expect(d.deleted).toEqual([]);

    await ctx.admin.call(`${ctx.base}/inbound/${pending}/delete`, {});
    expect((await ctx.admin.call(`${ctx.base}/inbound/${ignored}/purge`, {})).status).toBe(400); // not in 已删除
    expect((await ctx.admin.call(`${ctx.base}/inbound/${pending}/purge`, {})).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM inbound_payments WHERE id = ?").bind(pending).first()).toBeNull();
  });

  it("moves a mistakenly ignored payment back to 待确认", async () => {
    const ctx = await setUpAdmin();
    const ignored = await add("U1", "ignored");
    const pending = await add("U2");
    expect((await ctx.admin.call(`${ctx.base}/inbound/${ignored}/unignore`, {})).status).toBe(200);
    const d = (await ctx.admin.call(`${ctx.base}/inbound`)).data;
    expect(d.open.map((i: { id: number }) => i.id).sort()).toEqual([ignored, pending].sort());
    expect(d.open.find((i: { id: number }) => i.id === ignored).reason).toBe("这次活动还没结算（忽略后移回）");
    // Only ignored ones: 待确认 and a second click are refused.
    const again = await ctx.admin.call(`${ctx.base}/inbound/${ignored}/unignore`, {});
    expect(again.data.error.message).toBe("只能把已忽略的收款移回待确认");
    expect((await ctx.admin.call(`${ctx.base}/inbound/${pending}/unignore`, {})).status).toBe(400);
  });

  it("lists every ignored payment, however many newer ones were linked", async () => {
    const ctx = await setUpAdmin();
    const old = await add("OLD", "ignored");
    await env.DB.prepare("UPDATE inbound_payments SET received_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(old)
      .run();
    for (let n = 0; n < 31; n++) await add(`L${n}`, "linked");
    const d = (await ctx.admin.call(`${ctx.base}/inbound`)).data;
    expect(d.done).toHaveLength(30);
    expect(d.ignored.map((i: { id: number }) => i.id)).toEqual([old]);
    // Ignored and moved back twice: the note is added once.
    for (let n = 0; n < 2; n++) {
      await ctx.admin.call(`${ctx.base}/inbound/${old}/unignore`, {});
      await ctx.admin.call(`${ctx.base}/inbound/${old}/ignore`, {});
    }
    expect((await ctx.admin.call(`${ctx.base}/inbound`)).data.ignored[0].reason).toBe("这次活动还没结算（忽略后移回）");
  });

  it("清空 needs the password and empties only 已删除", async () => {
    const ctx = await setUpAdmin();
    for (const t of ["B1", "B2"]) await ctx.admin.call(`${ctx.base}/inbound/${await add(t)}/delete`, {});
    const kept = await add("B3");
    expect((await ctx.admin.call(`${ctx.base}/inbound/trash/clear`, { password: "nope" })).status).toBe(401);
    expect((await ctx.admin.call(`${ctx.base}/inbound`)).data.deleted).toHaveLength(2);
    const res = await ctx.admin.call(`${ctx.base}/inbound/trash/clear`, { password: "initial-password" });
    expect(res.data).toEqual({ ok: true, removed: 2 });
    const d = (await ctx.admin.call(`${ctx.base}/inbound`)).data;
    expect(d.deleted).toEqual([]);
    expect(d.open.map((i: { id: number }) => i.id)).toEqual([kept]);
  });

  it("the cron removes what has been in 已删除 for more than 30 days", async () => {
    const ctx = await setUpAdmin();
    const old = await add("C1");
    const recent = await add("C2");
    for (const id of [old, recent]) await ctx.admin.call(`${ctx.base}/inbound/${id}/delete`, {});
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    await env.DB.prepare("UPDATE inbound_payments SET deleted_at = ? WHERE id = ?").bind(daysAgo(31), old).run();
    await env.DB.prepare("UPDATE inbound_payments SET deleted_at = ? WHERE id = ?").bind(daysAgo(29), recent).run();
    await purgeDeletedInbound(env);
    expect((await ctx.admin.call(`${ctx.base}/inbound`)).data.deleted.map((i: { id: number }) => i.id)).toEqual([
      recent,
    ]);
  });

  it("shows trashed payments as 已删除 in the export", async () => {
    const ctx = await setUpAdmin();
    expect((await ctx.admin.call(`${ctx.base}/inbound/${await add("X1")}/delete`, {})).status).toBe(200);
    const table = await TABLES.inbound.build(env);
    expect(table.rows.find((r) => r.includes("X1"))).toContain("已删除");
  });
});
