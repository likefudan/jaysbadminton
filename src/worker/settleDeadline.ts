import { remindIfExpired } from "./appointments";
import { SYSTEM, audit } from "./audit";
import { bt } from "./botLang";
import { getSettings, now } from "./db";
import { syncDeadline } from "./deadlines";
import type { Env } from "./env";
import { day } from "./eventText";
import type { EventRow } from "./events";
import { message, once } from "./notify";
import { sendToManagerAndOwner } from "./telegram";

/**
 * 结算期限 (Ke Li 2026-11-05): an event that collects money and still isn't finalized this many
 * hours after it ends goes to history by itself: 已结束（未结算）, nothing billed, nobody owes, and
 * it can't be reopened. One nobody signed up for is cancelled instead. Until then 结算提醒 reminds
 * whoever runs it every half hour (notify.ts), with a warning in the last two hours.
 */

export const SETTLE_DEADLINE_DEFAULT_HOURS = 48;
export const SETTLE_DEADLINE_MAX_HOURS = 720;
/** 还剩不到 2 小时: the reminder says it will be archived. */
export const SETTLE_WARN_MS = 2 * 3600_000;

export interface SettleDeadline {
  /** 0: off, never archived by itself. */
  hours: number;
  /** When the setting came into force (the release, or turning it back on): hours count from here at the earliest. */
  since: string | null;
}

export async function settleDeadline(env: Env): Promise<SettleDeadline> {
  const s = await getSettings(env.DB, ["settle_deadline_hours", "settle_deadline_since"]);
  const n = Number(s.settle_deadline_hours ?? SETTLE_DEADLINE_DEFAULT_HOURS);
  return {
    hours: Number.isInteger(n) && n >= 0 ? n : SETTLE_DEADLINE_DEFAULT_HOURS,
    since: s.settle_deadline_since ?? null,
  };
}

/**
 * When an event is archived unsettled, or null when the setting is off. From its end; one created
 * afterwards (补建) from its creation, and nothing earlier than when the setting came into force.
 */
export function settleDueAt(e: Pick<EventRow, "end_at" | "created_at">, cfg: SettleDeadline): number | null {
  if (!cfg.hours) return null;
  const from = Math.max(
    new Date(e.end_at).getTime(),
    new Date(e.created_at).getTime(),
    cfg.since ? new Date(cfg.since).getTime() : 0,
  );
  return from + cfg.hours * 3600_000;
}

/** From the cron: closed, money-collecting events past their 结算期限. */
export async function archiveUnsettled(env: Env, at: Date = new Date()): Promise<void> {
  const cfg = await settleDeadline(env);
  if (!cfg.hours) return;
  const { results } = await env.DB.prepare(
    "SELECT * FROM events WHERE status = 'closed' AND no_fee = 0 AND end_at <= ?",
  )
    .bind(new Date(at.getTime() - cfg.hours * 3600_000).toISOString())
    .all<EventRow>();
  for (const e of results) {
    const due = settleDueAt(e, cfg);
    if (due === null || due > at.getTime()) continue;
    try {
      await archiveOne(env, e, cfg.hours);
    } catch (err) {
      console.error(`archiving unsettled event ${e.id} failed:`, err);
    }
  }
}

async function archiveOne(env: Env, e: EventRow, hours: number): Promise<void> {
  const signed = await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?")
    .bind(e.id)
    .first<{ n: number }>();
  const empty = (signed?.n ?? 0) === 0;
  // Guarded, so a Finalize (or a second cron run) at the same moment wins or loses cleanly.
  const res = await env.DB.prepare(
    empty
      ? "UPDATE events SET status = 'cancelled' WHERE id = ? AND status = 'closed'"
      : "UPDATE events SET status = 'settled', settled_at = ?2, unsettled = 1 WHERE id = ?1 AND status = 'closed'",
  )
    .bind(e.id, ...(empty ? [] : [now()]))
    .run();
  if (!res.meta.changes) return;
  await audit(
    env,
    e.id,
    SYSTEM,
    empty ? "cancel" : "end",
    empty
      ? `活动结束 ${hours} 小时，没有人报名，自动取消`
      : `活动结束 ${hours} 小时还没有结算，自动归档（未结算，不收费）`,
  );
  // It's archived already: what follows is logged if it fails, never undoes it.
  try {
    await syncDeadline(env, e.id);
    await remindIfExpired(env, e.payee_id);
    if (!empty)
      await once(env, e.id, "unsettled", "once", () =>
        sendToManagerAndOwner(env, e, (l) =>
          message(
            l,
            bt(l, "🗄 {day} 的活动结束 {hours} 小时还没有结算，已自动归档：不出账单，不收费，以后也不能再结算。", {
              day: day(e, l),
              hours,
            }),
          ),
        ),
      );
  } catch (err) {
    console.error(`after archiving event ${e.id}:`, err);
  }
}
