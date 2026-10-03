import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { recordCronError } from "./health";
import { deadlineNotices, nextDeadlineAlarm } from "./notify";

/**
 * One per event: an alarm set for its 截止前提醒 and then its deadline, so 报名截止 goes out the
 * moment sign-up closes instead of at the next cron run. The cron still runs every 15 minutes and
 * sends anything an alarm missed; notification_log keeps the two from sending the same notice twice.
 */
export class DeadlineAlarm extends DurableObject<Env> {
  /** Points the alarm at the event's next moment, or clears it. Called whenever the deadline may have changed. */
  async sync(eventId: number): Promise<void> {
    await this.ctx.storage.put("eventId", eventId);
    const at = await nextDeadlineAlarm(this.env, eventId);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const eventId = await this.ctx.storage.get<number>("eventId");
    if (eventId === undefined) return;
    try {
      await deadlineNotices(this.env, eventId);
    } catch (err) {
      await recordCronError(this.env, err); // shows up in the weekly digest's health check
      throw err; // Cloudflare retries a failed alarm
    }
    // After the reminder, the deadline is next; after the deadline there is nothing left.
    const next = await nextDeadlineAlarm(this.env, eventId);
    if (next !== null && next > Date.now()) await this.ctx.storage.setAlarm(next);
  }
}

/** Re-aims an event's alarm. Never fails the request: the cron sends anything a missed alarm would have. */
export async function syncDeadline(env: Env, eventId: number): Promise<void> {
  try {
    await env.DEADLINES.get(env.DEADLINES.idFromName(String(eventId))).sync(eventId);
  } catch (err) {
    console.error(`deadline alarm for event ${eventId} failed:`, err);
  }
}

/** From the cron, and after the reminder settings change (every open event's reminder may have moved). */
export async function syncAllDeadlines(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM events WHERE status = 'open'").all<{ id: number }>();
  for (const r of results) await syncDeadline(env, r.id);
}
