import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pacificToUtc } from "../src/shared/time";
import { runScheduled } from "../src/worker/notify";
import { archiveUnsettled } from "../src/worker/settleDeadline";
import { Client, billingScenario, createTestEvent, setUpAdmin } from "./helpers";

let telegram: string[] = [];

beforeEach(() => {
  telegram = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.text) telegram.push(body.text);
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
});
afterEach(() => vi.restoreAllMocks());

const connectChat = () => env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();

/** The event ended `hours` ago (and was made long before). */
const endedAgo = (id: number, hours: number) =>
  env.DB.prepare(
    "UPDATE events SET status = 'closed', start_at = ?, end_at = ?, deadline_at = ?, created_at = '2026-01-01T00:00:00Z' WHERE id = ?",
  )
    .bind(
      new Date(Date.now() - (hours + 2) * 3600_000).toISOString(),
      new Date(Date.now() - hours * 3600_000).toISOString(),
      new Date(Date.now() - (hours + 3) * 3600_000).toISOString(),
      id,
    )
    .run();

const row = async (id: number) =>
  (await env.DB.prepare("SELECT status, unsettled, finalized_at FROM events WHERE id = ?").bind(id).first<{
    status: string;
    unsettled: number;
    finalized_at: string | null;
  }>())!;

describe("结算期限", () => {
  it("archives an event not finalized 48 hours after it ended, with nothing billed, for good", async () => {
    const s = await billingScenario();
    await connectChat();
    await endedAgo(s.e.id, 47);
    await archiveUnsettled(env);
    expect((await row(s.e.id)).status).toBe("closed");

    await endedAgo(s.e.id, 49);
    await archiveUnsettled(env);
    await archiveUnsettled(env); // a second run changes nothing and says nothing again
    expect(await row(s.e.id)).toEqual({ status: "settled", unsettled: 1, finalized_at: null });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE event_id = ?")
      .bind(s.e.id)
      .first<{ n: number }>();
    expect(n!.n).toBe(0);
    const notes = telegram.filter((t) => t.includes("已自动归档"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("48 小时");

    // It can't be settled any more, and members see it in history with no charge.
    expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).status).toBe(400);
    const detail = (await s.admin.call(s.eb)).data;
    expect(detail.unsettled).toBe(true);
    const mine = (await new Client().call(`${s.alice.base}/events`)).data;
    expect(mine.history.find((h: { id: number }) => h.id === s.e.id)).toMatchObject({ unsettled: true });
    // Nor reminded about.
    telegram = [];
    await runScheduled(env);
    expect(telegram.filter((t) => t.includes("还没有结算"))).toEqual([]);
  });

  it("cancels an ended event nobody signed up for", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await endedAgo(e.id, 49);
    await archiveUnsettled(env);
    expect((await row(e.id)).status).toBe("cancelled");
  });

  it("leaves finalized events alone", async () => {
    const s = await billingScenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    await env.DB.prepare(
      "UPDATE events SET end_at = '2026-01-01T00:00:00Z', created_at = '2026-01-01T00:00:00Z'",
    ).run();
    await archiveUnsettled(env);
    expect((await row(s.e.id)).status).toBe("finalized");
  });

  it("is set in hours, can be turned off, and counts from when it was turned back on", async () => {
    const s = await billingScenario();
    expect((await s.admin.call(`${s.base}/settings`)).data.settleDeadlineHours).toBe(48);
    expect((await s.admin.call(`${s.base}/settings`, { settleDeadlineHours: 721 })).status).toBe(400);
    expect((await s.admin.call(`${s.base}/settings`, { settleDeadlineHours: 1.5 })).status).toBe(400);

    await endedAgo(s.e.id, 100);
    expect((await s.admin.call(`${s.base}/settings`, { settleDeadlineHours: 0 })).status).toBe(200);
    await archiveUnsettled(env);
    expect((await row(s.e.id)).status).toBe("closed");

    // Back on: it ended long ago, but gets its 24 hours from now.
    await s.admin.call(`${s.base}/settings`, { settleDeadlineHours: 24 });
    expect((await s.admin.call(`${s.base}/settings`)).data.settleDeadlineHours).toBe(24);
    await archiveUnsettled(env);
    expect((await row(s.e.id)).status).toBe("closed");
    await archiveUnsettled(env, new Date(Date.now() + 25 * 3600_000));
    expect((await row(s.e.id)).status).toBe("settled");
  });

  it("warns in the reminder when less than 2 hours are left", async () => {
    const s = await billingScenario();
    await connectChat();
    const noon = new Date(pacificToUtc(s.e.date, "12:00")).getTime();
    await env.DB.prepare(
      "UPDATE events SET status = 'closed', end_at = ?, created_at = '2026-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(new Date(noon - 46.5 * 3600_000).toISOString(), s.e.id)
      .run();
    await runScheduled(env, new Date(noon - 26 * 3600_000)); // 10:00 the day before: plenty of time
    expect(telegram.filter((t) => t.includes("还没有结算"))).toHaveLength(1);
    expect(telegram.some((t) => t.includes("还剩不到"))).toBe(false);
    await runScheduled(env, new Date(noon)); // 1.5 hours left
    expect(telegram.filter((t) => t.includes("还剩不到 2 小时"))).toHaveLength(1);
  });
});
