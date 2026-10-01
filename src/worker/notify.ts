import { dollars } from "../shared/settle";
import { formatDateZh, toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import { type EventRow, roster } from "./events";
import { escapeHtml, sendToOwner } from "./telegram";

/**
 * Every notification goes to the Owner's Telegram: first what the Owner needs to know, then,
 * when there is one, a block of text ready to paste into WeChat (a <pre> block copies in one tap).
 */
export function message(owner: string, wechat?: string): string {
  const head = escapeHtml(owner);
  return wechat ? `${head}\n\n—— 可复制到微信 ——\n<pre>${escapeHtml(wechat)}</pre>` : head;
}

export interface NotifySettings {
  reminderEnabled: boolean;
  reminderHours: number;
  dunningHour: number;
}

export async function notifySettings(env: Env): Promise<NotifySettings> {
  const s = await getSettings(env.DB, ["reminder_enabled", "reminder_hours", "dunning_hour"]);
  return {
    reminderEnabled: s.reminder_enabled !== "0",
    reminderHours: Number(s.reminder_hours ?? 6),
    dunningHour: Number(s.dunning_hour ?? 10),
  };
}

/**
 * Sends at most once per (event, type, key). The log row is written first so overlapping cron
 * runs cannot both send; if Telegram fails the row is removed and the next run tries again.
 */
async function once(env: Env, eventId: number, type: string, key: string, send: () => Promise<boolean>): Promise<void> {
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO notification_log (event_id, type, sent_on, sent_at) VALUES (?, ?, ?, ?)")
    .bind(eventId, type, key, now())
    .run();
  if (claim.meta.changes === 0) return;
  if (!(await send())) {
    await env.DB.prepare("DELETE FROM notification_log WHERE event_id = ? AND type = ? AND sent_on = ?").bind(eventId, type, key).run();
  }
}

const day = (e: EventRow) => formatDateZh(e.date);
const when = (e: EventRow) => `${day(e)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`;
const eventLink = (env: Env, e: EventRow) => `${env.SITE_ORIGIN}/e/${e.code}`;

async function headcount(env: Env, eventId: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?").bind(eventId).first<{ n: number }>();
  return r?.n ?? 0;
}

// ---- Scheduled jobs (cron, every 10 minutes) ----

export async function runScheduled(env: Env, at: Date = new Date()): Promise<void> {
  const cfg = await notifySettings(env);
  const { results: events } = await env.DB.prepare("SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized')").all<EventRow>();
  for (const e of events) {
    try {
      await deadlineReminder(env, e, at, cfg);
      await closedNotice(env, e, at);
      await settleReminder(env, e, at);
      await dailyDunning(env, e, at, cfg);
    } catch (err) {
      console.error(`notifications for event ${e.id} failed:`, err);
    }
  }
}

/** 截止前提醒: once per deadline, only if the event existed before the reminder window opened. */
async function deadlineReminder(env: Env, e: EventRow, at: Date, cfg: NotifySettings): Promise<void> {
  if (e.status !== "open" || !cfg.reminderEnabled || cfg.reminderHours <= 0) return;
  const deadline = new Date(e.deadline_at).getTime();
  const windowStart = deadline - cfg.reminderHours * 3600_000;
  if (at.getTime() < windowStart || at.getTime() >= deadline) return;
  if (new Date(e.created_at).getTime() > windowStart) return;
  await once(env, e.id, "deadline_reminder", e.deadline_at, async () => {
    const n = await headcount(env, e.id);
    const left = Math.max(1, Math.round((deadline - at.getTime()) / 3600_000));
    return sendToOwner(
      env,
      message(
        `⏰ ${day(e)} 的活动报名还剩约 ${left} 小时截止，目前 ${n} 人。`,
        `${when(e)} 羽毛球报名还剩 ${left} 小时截止，目前 ${n} 人，还没报名的抓紧啦！\n${eventLink(env, e)}`,
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
    return sendToOwner(
      env,
      message(
        `🔒 ${day(e)} 的活动报名已截止，共 ${list.length} 人。`,
        `${when(e)} 羽毛球报名已截止，共 ${list.length} 人。\n地点：${e.location}${e.address ? `（${e.address}）` : ""}\n${names}`,
      ),
    );
  });
}

/** 结算提醒: hourly once the event is over and not finalized, quiet from 22:00 to 8:00. */
async function settleReminder(env: Env, e: EventRow, at: Date): Promise<void> {
  if (e.status !== "closed" || at.getTime() < new Date(e.end_at).getTime()) return;
  const p = toPacific(at);
  const hour = Number(p.time.slice(0, 2));
  if (hour >= 22 || hour < 8) return;
  await once(env, e.id, "settle_reminder", `${p.date}T${p.time.slice(0, 2)}`, async () =>
    sendToOwner(
      env,
      message(
        `💰 ${day(e)} 的活动已经结束，还没有结算（报名 ${await headcount(env, e.id)} 人）。\n请打开管理页：标记没来的人，填写场地费和用球数，然后点 Finalize。`,
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
      `SELECT p.amount_due_cents, p.amount_paid_cents, p.status, m.username, m.wechat_nickname
       FROM payments p JOIN members m ON m.id = p.member_id WHERE p.event_id = ? ORDER BY m.username`,
    )
      .bind(e.id)
      .all<{ amount_due_cents: number; amount_paid_cents: number; status: string; username: string; wechat_nickname: string }>();
    const owing = pays.filter((x) => x.status !== "paid");
    if (owing.length === 0) return true;
    const due = pays.reduce((t, x) => t + x.amount_due_cents, 0);
    const paid = pays.reduce((t, x) => t + x.amount_paid_cents, 0);
    const lines = owing.map((x) => `${x.username} 还差 $${dollars(x.amount_due_cents - x.amount_paid_cents)}`).join("\n");
    const ok = await sendToOwner(
      env,
      message(
        `📋 ${day(e)} 收款汇总：应收 $${dollars(due)}，已收 $${dollars(paid)}；已付清 ${pays.length - owing.length} 人，未付清 ${owing.length} 人：\n${lines}\n\n下面是每个人的账单提醒，可以分别复制到微信私聊。`,
      ),
    );
    if (!ok) return false;
    for (const x of owing) {
      const owed = dollars(x.amount_due_cents - x.amount_paid_cents);
      const text =
        x.status === "partial"
          ? `${x.username}，${day(e)}羽毛球的费用还差 $${owed} 没付哦，麻烦通过你的专属链接补一下，谢谢！`
          : `${x.username}，${day(e)}羽毛球的费用 $${owed} 还没付哦，麻烦通过你的专属链接付一下，谢谢！`;
      await sendToOwner(env, message(`账单提醒：${x.username}（微信：${x.wechat_nickname}）`, text));
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
    return sendToOwner(
      env,
      message(
        `✅ ${day(e)} 已结算，应收合计 $${dollars(total)}：\n${lines}`,
        `${day(e)}羽毛球的费用已经出来了，请打开自己的专属链接查看金额并付款，谢谢！`,
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
      .first<{ court_total_cents: number; shuttle_count: number; shuttle_price_cents: number; registered_count: number; attended_count: number }>();
    const pay = await env.DB.prepare(
      `SELECT COUNT(*) AS n, SUM(amount_due_cents) AS due, SUM(amount_paid_cents) AS paid,
         SUM(MAX(amount_paid_cents - amount_due_cents - refunded_cents, 0)) AS refund
       FROM payments WHERE event_id = ?`,
    )
      .bind(e.id)
      .first<{ n: number; due: number; paid: number; refund: number }>();
    const lines = [
      "🎉 费用已全部收齐，活动已归档",
      "",
      `日期：${e.date.slice(0, 4)}年${day(e)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`,
      `活动编号：jbm${e.date.replace(/-/g, "")}${e.code.slice(4).toLowerCase()}`,
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
    return sendToOwner(env, message(lines.join("\n")));
  });
}

/** A Venmo payment that needs the Owner: 待确认, a partial payment or an over-payment. */
export async function notifyPayment(
  env: Env,
  kind: "review" | "partial" | "overpaid",
  info: { payer: string; amountCents: number; note: string; reason?: string; paymentId?: number },
): Promise<void> {
  let text: string;
  if (kind === "review") {
    text = `❓ 有一笔 Venmo 付款需要确认：${info.payer} $${dollars(info.amountCents)}，备注「${info.note}」。\n原因：${info.reason}\n请到管理页「收款」把它关联到某人名下，或者忽略。`;
  } else {
    const p = await env.DB.prepare(
      `SELECT p.amount_due_cents, p.amount_paid_cents, p.refunded_cents, m.username, e.date
       FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
    )
      .bind(info.paymentId)
      .first<{ amount_due_cents: number; amount_paid_cents: number; refunded_cents: number; username: string; date: string }>();
    if (!p) return;
    const d = formatDateZh(p.date);
    text =
      kind === "partial"
        ? `💵 ${p.username} 付了 $${dollars(info.amountCents)}（${d}），还差 $${dollars(p.amount_due_cents - p.amount_paid_cents)}。`
        : `↩️ ${p.username} 多付了 $${dollars(p.amount_paid_cents - p.amount_due_cents - p.refunded_cents)}（${d}，应付 $${dollars(p.amount_due_cents)}，共收到 $${dollars(p.amount_paid_cents)}），需要退款，见管理页「收款」。`;
  }
  await sendToOwner(env, message(text));
}
