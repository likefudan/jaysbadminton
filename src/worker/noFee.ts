import { remindIfExpired } from "./appointments";
import { SYSTEM, audit } from "./audit";
import { now } from "./db";
import { syncDeadline } from "./deadlines";
import type { Env } from "./env";
import { type EventRow, NO_FEE_END_AFTER_MS } from "./events";
import { badRequest } from "./http";

/**
 * 无需收款 (Ke Li 2026-11-04): an event at a venue where everyone pays at the door. There is
 * nothing to settle or collect, so it goes from sign-up straight to history ('settled', no
 * Finalize): by hand from the admin page, or by itself an hour after it ends.
 */

/** Ends one 无需收款 event now (现在结束活动), once sign-up has closed. */
export async function endNoFeeEvent(env: Env, e: EventRow, actor: string): Promise<void> {
  if (!e.no_fee) throw badRequest("这个活动需要结算收款，请在下面填写费用后 Finalize");
  if (e.status === "open") throw badRequest("报名还没截止，请先截止报名再结束活动");
  if (e.status !== "closed") throw badRequest("这个活动已经结束了");
  const ended = await archive(env, "id = ?1 AND status = 'closed'", e.id);
  if (!ended.length) throw badRequest("这个活动已经结束了");
  await audit(env, e.id, actor, "end", "结束活动（无需收款），存进历史活动");
  await afterEnd(env, ended);
}

/**
 * From the cron: 无需收款 events an hour past their end time. One created after the fact (补建)
 * also gets its hour from creation, so whoever made it can still fix the list first.
 */
export async function endDueNoFeeEvents(env: Env, at: Date = new Date()): Promise<void> {
  const ended = await archive(
    env,
    "end_at <= ?1 AND created_at <= ?1",
    new Date(at.getTime() - NO_FEE_END_AFTER_MS).toISOString(),
  );
  for (const e of ended) await audit(env, e.id, SYSTEM, "end", "活动结束 1 小时，自动结束（无需收款）");
  await afterEnd(env, ended);
}

/** `where` binds its value as ?1. */
async function archive(env: Env, where: string, value: string | number) {
  const { results } = await env.DB.prepare(
    `UPDATE events SET status = 'settled', settled_at = ?2
     WHERE no_fee = 1 AND status IN ('open', 'closed') AND ${where} RETURNING id, payee_id`,
  )
    .bind(value, now())
    .all<{ id: number; payee_id: string | null }>();
  return results;
}

/** It has ended already: a failure here is logged, never reported as the end failing. */
async function afterEnd(env: Env, ended: { id: number; payee_id: string | null }[]) {
  for (const e of ended) {
    try {
      await syncDeadline(env, e.id); // no 截止 or 快开始了 for an event that's over
      await remindIfExpired(env, e.payee_id);
    } catch (err) {
      console.error(`after ending event ${e.id}:`, err);
    }
  }
}
