import { createExecutionContext, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import { createTestEvent, setUpAdmin } from "./helpers";

let texts: string[] = [];

beforeEach(() => {
  texts = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    if (url.endsWith("/sendMessage")) texts.push(JSON.parse(String(init?.body)).text);
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
});
afterEach(() => vi.restoreAllMocks());

const connectChat = () => env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
const stub = (eventId: number) => env.DEADLINES.get(env.DEADLINES.idFromName(String(eventId)));
const alarmOf = (eventId: number) => runInDurableObject(stub(eventId), (_o, state) => state.storage.getAlarm());
const status = async (eventId: number) =>
  (await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(eventId).first<{ status: string }>())!.status;

describe("deadline alarms", () => {
  it("aims a new event's alarm at its reminder, or at the deadline when reminders are off", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const deadline = Date.parse(e.deadlineAt);
    expect(await alarmOf(e.id)).toBe(deadline - 6 * 3600_000);

    await ctx.admin.call(`${ctx.base}/settings`, { reminderEnabled: false });
    expect(await alarmOf(e.id)).toBe(deadline);
  });

  it("gives an open event without an alarm (created before alarms existed) one at the next cron run", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await runInDurableObject(stub(e.id), (_o, state) => state.storage.deleteAlarm());
    expect(await alarmOf(e.id)).toBeNull();
    const c = createExecutionContext();
    await worker.scheduled!({ scheduledTime: Date.now(), cron: "*/15 * * * *", noRetry() {} } as ScheduledController, env, c);
    await waitOnExecutionContext(c);
    expect(await alarmOf(e.id)).toBe(Date.parse(e.deadlineAt) - 6 * 3600_000);
  });

  it("closes sign-up and posts the roster as soon as the deadline alarm fires", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const e = await createTestEvent(ctx, { joinSelf: true });
    await env.DB.prepare("UPDATE events SET deadline_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), e.id).run();
    await stub(e.id).sync(e.id);
    await runDurableObjectAlarm(stub(e.id)); // false when the alarm is already firing by itself
    await vi.waitFor(() => expect(texts).toHaveLength(1));
    expect(await status(e.id)).toBe("closed");
    expect(texts).toEqual([expect.stringContaining("报名已截止，共 1 人")]);
    expect(await alarmOf(e.id)).toBeNull(); // nothing left to do
  });

  it("posts the roster right away when sign-up is closed early, and only once", async () => {
    const ctx = await setUpAdmin();
    await connectChat();
    const e = await createTestEvent(ctx, { joinSelf: true });
    await ctx.admin.call(`${ctx.base}/events/${e.id}/close-now`, {});
    await runDurableObjectAlarm(stub(e.id)); // false when the alarm is already firing by itself
    await vi.waitFor(() => expect(texts).toHaveLength(1));
    await stub(e.id).sync(e.id); // aims it at now again: the notice is not sent a second time
    await runDurableObjectAlarm(stub(e.id));
    await new Promise((r) => setTimeout(r, 100));
    expect(texts).toEqual([expect.stringContaining("报名已截止，共 1 人")]);
  });

  it("follows the deadline when sign-up is reopened, and clears the alarm when the event is cancelled", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await env.DB.prepare("UPDATE events SET status = 'closed', deadline_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(e.id).run();
    await ctx.admin.call(`${ctx.base}/events/${e.id}/reopen`, { date: e.date, time: "18:00" });
    const reopened = await env.DB.prepare("SELECT deadline_at FROM events WHERE id = ?").bind(e.id).first<{ deadline_at: string }>();
    expect(await alarmOf(e.id)).toBe(Date.parse(reopened!.deadline_at) - 6 * 3600_000);

    await ctx.admin.call(`${ctx.base}/events/${e.id}/cancel`, {});
    expect(await alarmOf(e.id)).toBeNull();
  });
});
