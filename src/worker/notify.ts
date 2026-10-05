import { dollars } from "../shared/settle";
import { formatDateZh, toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import { type EventRow, closeExpired, roster } from "./events";
import { forwardingWatch, recordCronError, weeklyDigest } from "./health";
import { eventManager } from "./organizers";
import { WECHAT_BLOCK, escapeHtml, sendToManager, sendToManagerAndOwner, sendToOwner } from "./telegram";

/**
 * Every notification goes to Telegram: an event's to whoever runs it (sendToManager), the rest to
 * the Owner. First what they need to know, then, when there is one, a block of text ready to paste
 * into WeChat (a <pre> block copies in one tap).
 */
export function message(head: string, wechat?: string): string {
  const text = escapeHtml(head);
  return wechat ? `${text}${WECHAT_BLOCK}<pre>${escapeHtml(wechat)}</pre>` : text;
}

export interface NotifySettings {
  reminderEnabled: boolean;
  reminderHours: number;
  dunningHour: number;
  weeklyDigest: boolean;
}

export async function notifySettings(env: Env): Promise<NotifySettings> {
  const s = await getSettings(env.DB, ["reminder_enabled", "reminder_hours", "dunning_hour", "weekly_digest"]);
  return {
    reminderEnabled: s.reminder_enabled !== "0",
    reminderHours: Number(s.reminder_hours ?? 6),
    dunningHour: Number(s.dunning_hour ?? 10),
    weeklyDigest: s.weekly_digest !== "0",
  };
}

/**
 * Sends at most once per (event, type, key). The log row is written first so overlapping cron
 * runs cannot both send; if Telegram fails (or building the message throws) the row is removed
 * and the next run tries again.
 */
export async function once(
  env: Env,
  eventId: number,
  type: string,
  key: string,
  send: () => Promise<boolean>,
): Promise<void> {
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO notification_log (event_id, type, sent_on, sent_at) VALUES (?, ?, ?, ?)",
  )
    .bind(eventId, type, key, now())
    .run();
  if (claim.meta.changes === 0) return;
  const release = () =>
    env.DB.prepare("DELETE FROM notification_log WHERE event_id = ? AND type = ? AND sent_on = ?")
      .bind(eventId, type, key)
      .run();
  let ok: boolean;
  try {
    ok = await send();
  } catch (err) {
    // A failure while building the message must not leave the claim behind, or it is never sent.
    await release();
    throw err;
  }
  if (!ok) await release();
}

/** "HappyTuesday 比赛 2026年10月7日 周三", or just the date when there is no title. */
const day = (e: EventRow) => (e.title ? `${e.title} ${formatDateZh(e.date)}` : formatDateZh(e.date));
const when = (e: EventRow) => `${day(e)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`;
const eventLink = (env: Env, e: EventRow) => `${env.SITE_ORIGIN}/e/${e.code}`;

/** The name of the organizer who runs the event; null for the Owner's events. */
async function organizerOf(env: Env, e: EventRow): Promise<string | null> {
  const id = await eventManager(env.DB, e);
  if (!id) return null;
  const m = await env.DB.prepare("SELECT username, is_owner FROM members WHERE id = ?")
    .bind(id)
    .first<{ username: string; is_owner: number }>();
  return !m || m.is_owner === 1 ? null : m.username;
}

/** 「（组织：某某）」 in the WeChat group texts of an organizer's event; nothing for the Owner's, as before. */
async function runBy(env: Env, e: EventRow): Promise<string> {
  const name = await organizerOf(env, e);
  return name ? `（组织：${name}）` : "";
}

const toManager = async (env: Env, e: { manager_id: string | null }, html: string) =>
  (await sendToManager(env, e, html)).ok;

async function headcount(env: Env, eventId: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?")
    .bind(eventId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// ---- Scheduled jobs (cron, every 15 minutes; each notice is sent once via notification_log) ----

export async function runScheduled(env: Env, at: Date = new Date()): Promise<void> {
  const cfg = await notifySettings(env);
  const { results: events } = await env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized')",
  ).all<EventRow>();
  for (const e of events) {
    try {
      await deadlineReminder(env, e, at, cfg);
      await closedNotice(env, e, at);
      await settleReminder(env, e, at);
      await dailyDunning(env, e, at, cfg);
    } catch (err) {
      console.error(`notifications for event ${e.id} failed:`, err);
      await recordCronError(env, err);
    }
  }
  try {
    await forwardingWatch(env, at, cfg);
    await weeklyDigest(env, at, cfg);
  } catch (err) {
    console.error("health notifications failed:", err);
    await recordCronError(env, err);
  }
}

/** When 截止前提醒 is due (ms), or null when it is off or the event was created inside its window. */
function reminderStart(e: EventRow, cfg: NotifySettings): number | null {
  if (!cfg.reminderEnabled || cfg.reminderHours <= 0) return null;
  const windowStart = new Date(e.deadline_at).getTime() - cfg.reminderHours * 3600_000;
  return new Date(e.created_at).getTime() > windowStart ? null : windowStart;
}

/** 截止前提醒: once per deadline, only if the event existed before the reminder window opened. */
async function deadlineReminder(env: Env, e: EventRow, at: Date, cfg: NotifySettings): Promise<void> {
  if (e.status !== "open") return;
  const deadline = new Date(e.deadline_at).getTime();
  const windowStart = reminderStart(e, cfg);
  if (windowStart === null || at.getTime() < windowStart || at.getTime() >= deadline) return;
  await once(env, e.id, "deadline_reminder", e.deadline_at, async () => {
    const n = await headcount(env, e.id);
    const left = Math.max(1, Math.round((deadline - at.getTime()) / 3600_000));
    return toManager(
      env,
      e,
      message(
        `⏰ ${day(e)} 的活动报名还剩约 ${left} 小时截止，目前 ${n} 人。`,
        `${when(e)} 羽毛球${await runBy(env, e)}报名还剩 ${left} 小时截止，目前 ${n} 人，还没报名的抓紧啦！\n${eventLink(env, e)}`,
      ),
    );
  });
}

/** 报名截止: the roster, once per deadline (a reopened event gets a new one). */
async function closedNotice(env: Env, e: EventRow, at: Date): Promise<void> {
  if (e.status !== "closed") return;
  const deadline = new Date(e.deadline_at).getTime();
  // Only fresh closings, so an old event never sends a stale notice.
  if (deadline > at.getTime() || at.getTime() - deadline > 24 * 3600_000) return;
  await once(env, e.id, "closed", e.deadline_at, async () => {
    const list = await roster(env, e.id);
    const names = list.map((r, i) => `${i + 1}. ${r.name}`).join("\n");
    return toManager(
      env,
      e,
      message(
        `🔒 ${day(e)} 的活动报名已截止，共 ${list.length} 人。`,
        `${when(e)} 羽毛球${await runBy(env, e)}报名已截止，共 ${list.length} 人。\n地点：${e.location}${e.address ? `（${e.address}）` : ""}\n${names}`,
      ),
    );
  });
}

// ---- Deadline alarms (see deadlines.ts): 截止前提醒 and 报名截止 on time, without waiting for the cron ----

/** Closes sign-up if the deadline has passed, then sends whichever of the two notices is due. */
export async function deadlineNotices(env: Env, eventId: number, at: Date = new Date()): Promise<void> {
  await closeExpired(env);
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e) return;
  await deadlineReminder(env, e, at, await notifySettings(env));
  await closedNotice(env, e, at);
}

/**
 * When the event's alarm should next fire (ms): the reminder or the deadline of an open event,
 * now for a freshly closed one (closed early, or edited past its deadline), otherwise null.
 */
export async function nextDeadlineAlarm(env: Env, eventId: number, at: Date = new Date()): Promise<number | null> {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e) return null;
  const deadline = new Date(e.deadline_at).getTime();
  if (e.status === "closed")
    return deadline <= at.getTime() && at.getTime() - deadline <= 24 * 3600_000 ? at.getTime() : null;
  if (e.status !== "open") return null;
  const reminder = reminderStart(e, await notifySettings(env));
  return reminder !== null && reminder > at.getTime() ? reminder : deadline;
}

/**
 * 结算提醒: hourly once the event is over and not finalized, quiet from 22:00 to 8:00. An event
 * nobody signed up for can't be finalized, so that one gets a single note suggesting 取消 instead.
 */
async function settleReminder(env: Env, e: EventRow, at: Date): Promise<void> {
  if (e.status !== "closed" || at.getTime() < new Date(e.end_at).getTime()) return;
  const p = toPacific(at);
  const hour = Number(p.time.slice(0, 2));
  if (hour >= 22 || hour < 8) return;
  const n = await headcount(env, e.id);
  if (n === 0) {
    await once(env, e.id, "settle_reminder", "empty", async () =>
      toManager(env, e, message(`💰 ${day(e)} 的活动已经结束，没有人报名，不用结算。\n可以在管理页取消这个活动。`)),
    );
    return;
  }
  await once(env, e.id, "settle_reminder", `${p.date}T${p.time.slice(0, 2)}`, async () =>
    toManager(
      env,
      e,
      message(
        `💰 ${day(e)} 的活动已经结束，还没有结算（报名 ${n} 人）。\n请打开管理页：标记没来的人，填写场地费和用球数，然后点 Finalize。`,
      ),
    ),
  );
}

/**
 * 每日收款汇总 + 账单提醒: from 24 h after Finalize, once a day at the configured hour, until
 * collected or stopped. One summary, then one message per person who still owes money.
 */
async function dailyDunning(env: Env, e: EventRow, at: Date, cfg: NotifySettings): Promise<void> {
  if (e.status !== "finalized" || e.dunning_stopped || !e.finalized_at) return;
  if (at.getTime() < new Date(e.finalized_at).getTime() + 24 * 3600_000) return;
  const p = toPacific(at);
  if (Number(p.time.slice(0, 2)) !== cfg.dunningHour) return;
  await once(env, e.id, "dunning", p.date, async () => {
    const { results: pays } = await env.DB.prepare(
      `SELECT p.amount_due_cents, p.amount_paid_cents, p.status, m.username, m.wechat_nickname,
         m.token_enc IS NOT NULL AS has_link, m.google_sub IS NOT NULL AS has_google
       FROM payments p JOIN members m ON m.id = p.member_id WHERE p.event_id = ? ORDER BY m.username`,
    )
      .bind(e.id)
      .all<{
        amount_due_cents: number;
        amount_paid_cents: number;
        status: string;
        username: string;
        wechat_nickname: string;
        has_link: number;
        has_google: number;
      }>();
    const owing = pays.filter((x) => x.status !== "paid");
    if (owing.length === 0) return true;
    const due = pays.reduce((t, x) => t + x.amount_due_cents, 0);
    const paid = pays.reduce((t, x) => t + x.amount_paid_cents, 0);
    const lines = owing
      .map((x) => `${x.username} 还差 $${dollars(x.amount_due_cents - x.amount_paid_cents)}`)
      .join("\n");
    const ok = await toManager(
      env,
      e,
      message(
        `📋 ${day(e)} 收款汇总：应收 $${dollars(due)}，已收 $${dollars(paid)}；已付清 ${pays.length - owing.length} 人，未付清 ${owing.length} 人：\n${lines}\n\n下面是每个人的账单提醒，可以分别复制到微信私聊。`,
      ),
    );
    if (!ok) return false;
    for (const x of owing) {
      const owed = dollars(x.amount_due_cents - x.amount_paid_cents);
      // Members who joined with Google have no link: they sign in instead. With neither, the
      // Owner sends them a new link anyway, so the text doesn't name one.
      const via = x.has_link ? "通过你的专属链接" : x.has_google ? "用 Google 登录网站" : "";
      const text =
        x.status === "partial"
          ? `${x.username}，${day(e)}羽毛球的费用还差 $${owed} 没付哦，麻烦${via}补一下，谢谢！`
          : `${x.username}，${day(e)}羽毛球的费用 $${owed} 还没付哦，麻烦${via}付一下，谢谢！`;
      await toManager(env, e, message(`账单提醒：${x.username}（微信：${x.wechat_nickname}）`, text));
    }
    return true;
  });
}

// ---- Immediate notifications ----

/** 结算完成: only the first Finalize, not later saves. */
export async function notifyFinalized(env: Env, e: EventRow): Promise<void> {
  await once(env, e.id, "finalized", "once", async () => {
    const { results } = await env.DB.prepare(
      `SELECT p.amount_due_cents, m.username FROM payments p JOIN members m ON m.id = p.member_id
       WHERE p.event_id = ? ORDER BY m.username`,
    )
      .bind(e.id)
      .all<{ amount_due_cents: number; username: string }>();
    const total = results.reduce((t, x) => t + x.amount_due_cents, 0);
    const lines = results.map((x) => `${x.username} $${dollars(x.amount_due_cents)}`).join("\n");
    return sendToManagerAndOwner(
      env,
      e,
      message(
        `✅ ${day(e)} 已结算，应收合计 $${dollars(total)}：\n${lines}`,
        `${day(e)}羽毛球${await runBy(env, e)}的费用已经出来了，请打开自己的专属链接（或用 Google 登录网站）查看金额并付款，谢谢！`,
      ),
    );
  });
}

/** 收齐通知: once, when the event is archived; a full record of the event for the Owner's archive. */
export async function notifyCollected(env: Env, eventId: number): Promise<void> {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e) return;
  await once(env, e.id, "collected", "once", async () => {
    const st = await env.DB.prepare(
      "SELECT court_total_cents, shuttle_count, shuttle_price_cents, registered_count, attended_count FROM settlements WHERE event_id = ?",
    )
      .bind(e.id)
      .first<{
        court_total_cents: number;
        shuttle_count: number;
        shuttle_price_cents: number;
        registered_count: number;
        attended_count: number;
      }>();
    const pay = await env.DB.prepare(
      `SELECT COUNT(*) AS n, SUM(amount_due_cents) AS due, SUM(amount_paid_cents) AS paid,
         SUM(MAX(amount_paid_cents - amount_due_cents, 0)) AS refund
       FROM payments WHERE event_id = ?`,
    )
      .bind(e.id)
      .first<{ n: number; due: number; paid: number; refund: number }>();
    const lines = [
      "🎉 费用已全部收齐，活动已归档",
      "",
      ...(e.title ? [`活动：${e.title}`] : []),
      `日期：${formatDateZh(e.date)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`,
      `活动编号：${e.number}`,
      `场馆：${e.location}`,
      ...(e.address ? [`地址：${e.address}`] : []),
    ];
    if (st) {
      const shuttle = st.shuttle_count * st.shuttle_price_cents;
      lines.push(
        `人数：报名 ${st.registered_count} 人，到场 ${st.attended_count} 人（${pay?.n ?? 0} 人付款）`,
        `费用：$${dollars(st.court_total_cents + shuttle)}`,
        `　场地费 $${dollars(st.court_total_cents)}`,
        `　球费 $${dollars(shuttle)}（${st.shuttle_count} 个 × $${dollars(st.shuttle_price_cents)}）`,
      );
    }
    if (pay) {
      lines.push(`应收 $${dollars(pay.due ?? 0)}，实收 $${dollars(pay.paid ?? 0)}`);
      if (pay.refund) lines.push(`还有多付的 $${dollars(pay.refund)} 需要退，见管理页「收款」。`);
    }
    return sendToManagerAndOwner(env, e, message(lines.join("\n")));
  });
}

/**
 * A Venmo payment that needs someone: 待确认 goes to the Owner, a partial payment or an
 * over-payment to whoever runs that event.
 */
export async function notifyPayment(
  env: Env,
  kind: "review" | "partial" | "overpaid",
  info: { payer: string; amountCents: number; note: string; reason?: string; paymentId?: number },
): Promise<void> {
  if (kind === "review") {
    await sendToOwner(
      env,
      message(
        `❓ 有一笔 Venmo 付款需要确认：${info.payer} $${dollars(info.amountCents)}，备注「${info.note}」。\n原因：${info.reason}\n请到管理页「收款」把它关联到某人名下，或者忽略。`,
      ),
    );
    return;
  }
  const p = await env.DB.prepare(
    `SELECT p.amount_due_cents, p.amount_paid_cents, p.refunded_cents, m.username, e.date, e.manager_id
     FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
  )
    .bind(info.paymentId)
    .first<{
      amount_due_cents: number;
      amount_paid_cents: number;
      refunded_cents: number;
      username: string;
      date: string;
      manager_id: string | null;
    }>();
  if (!p) return;
  const d = formatDateZh(p.date);
  const text =
    kind === "partial"
      ? `💵 ${p.username} 付了 $${dollars(info.amountCents)}（${d}），还差 $${dollars(p.amount_due_cents - p.amount_paid_cents)}。`
      : `↩️ ${p.username} 多付了 $${dollars(p.amount_paid_cents - p.amount_due_cents)}（${d}，应付 $${dollars(p.amount_due_cents)}，共收到 $${dollars(p.amount_paid_cents + p.refunded_cents)}），需要退款，见管理页「收款」。`;
  await sendToManager(env, p, message(text));
}

/**
 * 新活动发起: the Owner hears when an organizer creates an event (their own, as before, send
 * nothing). The organizer isn't told about what they just did.
 */
export async function notifyCreated(env: Env, e: EventRow): Promise<void> {
  const name = await organizerOf(env, e);
  if (!name) return;
  const where = `${e.location}${e.address ? `（${e.address}）` : ""}`;
  await sendToOwner(env, message(`🆕 组织者 ${name} 发起了新活动：\n${when(e)}\n地点：${where}\n${eventLink(env, e)}`));
}
