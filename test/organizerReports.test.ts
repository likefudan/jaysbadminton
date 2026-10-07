import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { exportAll } from "../src/worker/export";
import { digestText } from "../src/worker/health";
import { recordEmailOutcome } from "../src/worker/inbound";
import { appoint, billingScenario, Client, expire, futureDate, GOOGLE, ORIGIN, request } from "./helpers";

/** Card 10: exports, the Google Sheet, the weekly digest and the forwarding check, per payee. */

const on = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const off = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "0" };
const json = async (res: Response) => (await res.json()) as any;

/**
 * The Owner's event (billingScenario: Jay, Alice, Bob) and one run by Alice, an organizer paid into
 * her own Venmo, which Jay and Bob play. Both finalized.
 */
async function scenario() {
  const s = await billingScenario();
  await s.admin.call(`${s.eb}/finalize`, s.fees);
  const org = await appoint(s.alice.id, "alice");
  expect(
    (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" }))
      .status,
  ).toBe(200);
  const created = await json(
    await request(`${GOOGLE}/events`, org, {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    }),
  );
  const ab = `${GOOGLE}/events/${created.id}`;
  await request(`${ab}/roster/add`, org, { memberId: s.owner, includeSelf: true });
  await new Client().call(`${s.bob.base}/events/${created.id}/signup`, { friends: [] });
  await expire(created.id);
  expect((await request(`${ab}/finalize`, org, s.fees)).status).toBe(200);
  return { ...s, org, aliceEvent: created.id as number };
}

describe("export and Google Sheet", () => {
  it("names each event's manager and payee, whose account each bill pays into, and each member's role", async () => {
    const s = await scenario();
    await env.DB.prepare(
      "INSERT INTO inbound_payments (received_at, payer_name, amount_cents, note, kind, payee_id) VALUES (?, 'Zed', 500, 'x', 'unmatched', ?), (?, 'Yan', 600, 'y', 'unmatched', NULL)",
    )
      .bind(new Date().toISOString(), s.alice.id, new Date().toISOString())
      .run();
    // Old rows from before the columns were filled in count as the Owner's.
    await env.DB.prepare("UPDATE events SET manager_id = NULL, payee_id = NULL WHERE id = ?").bind(s.e.id).run();

    const { tables } = await exportAll(on);
    const col = (t: keyof typeof tables, name: string) => tables[t].columns.indexOf(name);
    const role = (name: string) => tables.members.rows.find((r) => r[1] === name)![col("members", "身份")];
    expect([role("Jay"), role("Alice"), role("Bob")]).toEqual(["群主", "组织者", "成员"]);
    expect(tables.members.columns).not.toContain("群主");

    const venue = col("events", "场馆");
    const owners = tables.events.rows.find((r) => r[venue] !== "Alice Gym")!;
    const alices = tables.events.rows.find((r) => r[venue] === "Alice Gym")!;
    expect(owners.slice(col("events", "负责人"))).toEqual(["Jay", "Jay"]);
    expect(alices.slice(col("events", "负责人"))).toEqual(["Alice", "Alice"]);

    const account = col("payments", "钱在谁的账户");
    const into = (e: (string | number)[]) => tables.payments.rows.filter((r) => r[0] === e[0]).map((r) => r[account]);
    expect(into(alices)).toEqual(["Alice", "Alice"]);
    expect(new Set(into(owners))).toEqual(new Set(["Jay"]));

    const inbound = (payer: string) => tables.inbound.rows.find((r) => r[1] === payer)![col("inbound", "钱在谁的账户")];
    expect([inbound("Zed"), inbound("Yan")]).toEqual(["Alice", "Jay"]);

    // With the feature off, nobody is an organizer, but money still goes where the data says.
    const offTables = (await exportAll(off)).tables;
    expect(offTables.members.rows.find((r) => r[1] === "Alice")![col("members", "身份")]).toBe("成员");
    expect(
      offTables.events.rows.find((r) => r[col("events", "场馆")] === "Alice Gym")!.slice(col("events", "收款人")),
    ).toEqual(["Alice"]);
  });
});

describe("weekly digest per payee", () => {
  it("logs whose account each Venmo email was for", async () => {
    const s = await billingScenario();
    await env.DB.prepare("DELETE FROM email_log").run();
    await recordEmailOutcome(env, "paid");
    await recordEmailOutcome(env, "paid", s.alice.id);
    const { results } = await env.DB.prepare("SELECT outcome, payee_id FROM email_log ORDER BY id").all();
    expect(results).toEqual([
      { outcome: "paid", payee_id: null },
      { outcome: "paid", payee_id: s.alice.id },
    ]);
    // Only the Owner's emails move the Owner's 转发状态.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'email_last_at'").first("n")).toBe(1);
  });

  it("gives each account its own block once someone besides the Owner collects", async () => {
    const s = await scenario();
    const recent = new Date(Date.now() - 86400_000).toISOString();
    await env.DB.prepare("DELETE FROM email_log").run();
    await env.DB.prepare(
      "INSERT INTO email_log (received_at, outcome, payee_id) VALUES (?1, 'paid', NULL), (?1, 'ignored', NULL), (?1, 'review', ?2)",
    )
      .bind(recent, s.alice.id)
      .run();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('email_last_at', ?)").bind(recent).run();
    await env.DB.prepare(
      "INSERT INTO inbound_payments (received_at, payer_name, amount_cents, note, kind, payee_id) VALUES (?, 'Zed', 500, 'x', 'unmatched', ?)",
    )
      .bind(recent, s.alice.id)
      .run();

    const text = await digestText(on, new Date());
    const [ownerBlock, aliceBlock] = text.split("【").slice(1);
    expect(ownerBlock).toContain("群主（你）的账户】");
    expect(ownerBlock).toContain("Venmo 邮件：收到 2 封（自动记账 1，无关收款（已忽略） 1）");
    expect(ownerBlock).toContain("待确认：没有");
    expect(ownerBlock).toContain("未付清账单：2 笔，共 $87.00");
    expect(ownerBlock).toContain("✓ 邮件转发");
    expect(aliceBlock).toContain("组织者 Alice 的账户】");
    expect(aliceBlock).toContain("Venmo 邮件：收到 1 封（待确认 1）");
    expect(aliceBlock).toContain("待确认：还有 1 笔由 Alice 处理");
    expect(aliceBlock).toContain("未付清账单：2 笔");
    expect(aliceBlock).toContain("⚠️ 邮件转发：还没收到过任何 Venmo 邮件");
    expect(text).toContain("✓ 定时任务：正常");

    // Forwarding quiet for days while her bills are out.
    const old = new Date(Date.now() - 10 * 86400_000).toISOString();
    await env.DB.prepare("UPDATE payment_profiles SET email_last_at = ? WHERE member_id = ?")
      .bind(old, s.alice.id)
      .run();
    expect(await digestText(on, new Date())).toContain("有欠款却很久没收到，请提醒 Alice 检查 Gmail 转发");

    // Revoked, with bills still paying into her account: a former payee, handled by the Owner.
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(s.alice.id).run();
    const former = await digestText(on, new Date());
    expect(former).toContain("【历史收款人 Alice 的账户】");
    expect(former).toContain("待确认：还有 1 笔要你处理");
    // Money is not gated by the flag: the block stays with it off.
    expect(await digestText(off, new Date())).toContain("【历史收款人 Alice 的账户】");

    // All paid and nothing else of hers this week: back to the Owner's digest as it always was.
    await env.DB.prepare("DELETE FROM email_log WHERE payee_id IS NOT NULL").run();
    await env.DB.prepare("DELETE FROM inbound_payments").run();
    await env.DB.prepare("UPDATE payments SET status = 'paid', amount_paid_cents = amount_due_cents WHERE event_id = ?")
      .bind(s.aliceEvent)
      .run();
    expect(await digestText(on, new Date())).not.toContain("【");
  });

  it("shows a quiet organizer with nothing collected yet", async () => {
    const s = await billingScenario();
    await appoint(s.alice.id, "alice");
    const text = await digestText(on, new Date());
    expect(text).toContain("【组织者 Alice 的账户】");
    expect(text).toContain("⚠️ 收款设置还没填 Venmo 用户名");
    // With the feature off she is no organizer, and nothing pays into her account.
    expect(await digestText(off, new Date())).not.toContain("【");
  });
});

describe("forwarding check on the pages", () => {
  it("warns the Owner and the organizer when bills are out but no Venmo email came for days", async () => {
    const s = await scenario();
    const block = async () => (await json(await request(`${s.base}/members`, s.admin.cookie))).organizers.list[0];
    const profile = async () => json(await request(`${GOOGLE}/payment-profile`, s.org));
    expect((await block()).quietBills).toBe(0);
    expect((await profile()).quietBills).toBe(0);

    await env.DB.prepare("UPDATE events SET finalized_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(s.aliceEvent)
      .run();
    expect((await block()).quietBills).toBe(2);
    expect((await profile()).quietBills).toBe(2);

    // A Venmo email for her account arrived: forwarding works.
    await env.DB.prepare("UPDATE payment_profiles SET email_last_at = ? WHERE member_id = ?")
      .bind(new Date().toISOString(), s.alice.id)
      .run();
    expect((await block()).quietBills).toBe(0);
    expect((await profile()).quietBills).toBe(0);
  });
});
