import { dollars } from "../shared/settle";
import { toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import { type EventRow, closeExpired, roster } from "./events";
import { type BotLang, type BotText, bt, botDate, btm, usd } from "./botLang";
import { day, venue, when } from "./eventText";
import { forwardingWatch, recordCronError, weeklyDigest } from "./health";
import { ROLE_TITLE, eventManager, isStaff, memberRole, organizersEnabled } from "./organizers";
import { START_PUSH_MS, drainPushes, pushSettle, pushStarting, sendRest } from "./push";
import { SETTLE_WARN_MS, settleDeadline, settleDueAt } from "./settleDeadline";
import {
  escapeHtml,
  sendLikewise,
  sendToManager,
  sendToManagerAndOwner,
  sendToOwner,
  sendToPayee,
  wechatBlock,
} from "./telegram";

/**
 * Every notification goes to Telegram: an event's to whoever runs it (sendToManager), the rest to
 * the Owner. First what they need to know, then, when there is one, a block of text ready to paste
 * into WeChat (a <pre> block copies in one tap). `head` is in the chat's language `l`; the WeChat
 * text is for the group and stays Simplified Chinese.
 */
export function message(l: BotLang, head: string, wechat?: string): string {
  const text = escapeHtml(head);
  return wechat ? `${text}${wechatBlock(l)}<pre>${escapeHtml(wechat)}</pre>` : text;
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

const eventLink = (env: Env, e: EventRow) => `${env.SITE_ORIGIN}/e/${e.code}`;

/** The name of the organizer who runs the event; null for the Owner's events. */
async function organizerOf(env: Env, e: EventRow): Promise<string | null> {
  return (await managerOf(env, e))?.name ?? null;
}

/** Who runs the event and as what (管理员 / 组织者), when that is not the Owner. */
async function managerOf(env: Env, e: EventRow): Promise<{ name: string; title: string } | null> {
  const id = await eventManager(env.DB, e);
  if (!id) return null;
  const m = await env.DB.prepare("SELECT username, is_owner, role, status, deleted_at FROM members WHERE id = ?")
    .bind(id)
    .first<{ username: string; is_owner: number; role: string; status: string; deleted_at: string | null }>();
  if (!m || m.is_owner === 1) return null;
  const role = memberRole(env, m);
  return { name: m.username, title: isStaff(role) ? ROLE_TITLE[role] : "组织者" };
}

/** 「（组织：某某）」 in the WeChat group texts of an organizer's event; nothing for the Owner's or with the feature off, as before. */
async function runBy(env: Env, e: EventRow): Promise<string> {
  if (!organizersEnabled(env)) return "";
  const name = await organizerOf(env, e);
  return name ? `（组织：${name}）` : "";
}

/** `adminPage`: the notice sends them to the admin page, so an organizer gets their link to it. */
const toManager = async (env: Env, e: { manager_id: string | null }, text: BotText, adminPage = false) =>
  (await sendToManager(env, e, text, adminPage)).ok;

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
      await startPush(env, e, at);
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
  try {
    // Pushes to members' browsers that a request and the PushSender couldn't send (a failure).
    if (await drainPushes(env)) await sendRest(env);
  } catch (err) {
    console.error("push notifications failed:", err);
    await recordCronError(env, err);
  }
}

/** When 截止前提醒 is due (ms), or null when it is off or the event was created inside its window. */
function reminderStart(e: EventRow, cfg: NotifySettings): number | null {
  // No deadline (报名截止时间 off): nothing to remind of; it just closes at the end.
  if (!cfg.reminderEnabled || cfg.reminderHours <= 0 || e.no_deadline) return null;
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
    const wechat = `${when(e)} 羽毛球${await runBy(env, e)}报名还剩 ${left} 小时截止，目前 ${n} 人，还没报名的抓紧啦！\n${eventLink(env, e)}`;
    return toManager(env, e, (l) =>
      message(
        l,
        bt(l, "⏰ {day} 的活动报名还剩约 {left} 小时截止，目前 {n} 人。", { day: day(e, l), left, n }),
        wechat,
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
    const wechat = `${when(e)} 羽毛球${await runBy(env, e)}报名已截止，共 ${list.length} 人。\n地点：${venue(e)}\n${names}`;
    return toManager(env, e, (l) =>
      message(l, bt(l, "🔒 {day} 的活动报名已截止，共 {n} 人。", { day: day(e, l), n: list.length }), wechat),
    );
  });
}

// ---- Deadline alarms (see deadlines.ts): 截止前提醒, 报名截止 and 快开始了 on time, without waiting for the cron ----

/** When 快开始了 is due (ms): START_PUSH_MS before the start. */
const startPushAt = (e: EventRow) => new Date(e.start_at).getTime() - START_PUSH_MS;

/**
 * 快开始了: a push to everyone on the event, once per start time, from START_PUSH_MS before the start
 * until it. An event made (or moved) closer to its start than that gets it straight away. Whether
 * anyone is subscribed or not, it counts as done.
 */
async function startPush(env: Env, e: EventRow, at: Date): Promise<boolean> {
  if (e.status !== "open" && e.status !== "closed") return false;
  if (at.getTime() < startPushAt(e) || at.getTime() >= new Date(e.start_at).getTime()) return false;
  let queued = false;
  await once(env, e.id, "start_push", e.start_at, async () => {
    queued = await pushStarting(env, e);
    return true;
  });
  return queued;
}

const logged = async (env: Env, eventId: number, type: string, key: string) =>
  (await env.DB.prepare("SELECT 1 FROM notification_log WHERE event_id = ? AND type = ? AND sent_on = ?")
    .bind(eventId, type, key)
    .first()) !== null;

/** Closes sign-up if the deadline has passed, then sends whichever of the notices is due. */
export async function deadlineNotices(env: Env, eventId: number, at: Date = new Date()): Promise<void> {
  await closeExpired(env);
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e) return;
  await deadlineReminder(env, e, at, await notifySettings(env));
  await closedNotice(env, e, at);
  // The pushes go out from the PushSender, each run with its own CPU.
  if (await startPush(env, e, at)) await sendRest(env);
}

/**
 * When the event's alarm should next fire (ms), or null: the reminder or the deadline of an open
 * event, now for a freshly closed one whose 报名截止 hasn't gone out (closed early, or edited past
 * its deadline), and 快开始了 START_PUSH_MS before the start (now, if that has passed and it hasn't
 * gone out), whichever comes first. `laterOnly` (right after the alarm ran): only what is still
 * ahead, so a notice that just failed (Telegram not connected, say) is left to the cron instead of
 * holding up the ones after it.
 */
export async function nextDeadlineAlarm(
  env: Env,
  eventId: number,
  at: Date = new Date(),
  laterOnly = false,
): Promise<number | null> {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e || (e.status !== "open" && e.status !== "closed")) return null;
  const t = at.getTime();
  const due: number[] = [];
  const deadline = new Date(e.deadline_at).getTime();
  if (e.status === "open") {
    const reminder = reminderStart(e, await notifySettings(env));
    due.push(reminder !== null && reminder > t ? reminder : deadline);
  } else if (deadline <= t && t - deadline <= 24 * 3600_000 && !(await logged(env, e.id, "closed", e.deadline_at))) {
    due.push(t);
  }
  if (t < new Date(e.start_at).getTime() && !(await logged(env, e.id, "start_push", e.start_at)))
    due.push(Math.max(startPushAt(e), t));
  const ahead = laterOnly ? due.filter((x) => x > t) : due;
  return ahead.length ? Math.min(...ahead) : null;
}

/**
 * 结算提醒: every half hour once the event is over and not finalized, quiet from 22:00 to 8:00, to
 * whoever runs it on Telegram and, for an organizer or admin, to their phone too. In the last two
 * hours before its 结算期限 it says it will be archived (settleDeadline.ts). An event nobody signed
 * up for can't be finalized, so that one gets a single note suggesting 取消 instead.
 */
async function settleReminder(env: Env, e: EventRow, at: Date): Promise<void> {
  if (e.status !== "closed" || e.no_fee || at.getTime() < new Date(e.end_at).getTime()) return;
  const p = toPacific(at);
  const hour = Number(p.time.slice(0, 2));
  if (hour >= 22 || hour < 8) return;
  const n = await headcount(env, e.id);
  if (n === 0) {
    await once(env, e.id, "settle_reminder", "empty", async () =>
      toManager(
        env,
        e,
        (l) =>
          message(
            l,
            bt(l, "💰 {day} 的活动已经结束，没有人报名，不用结算。\n可以在管理页取消这个活动。", { day: day(e, l) }),
          ),
        true,
      ),
    );
    return;
  }
  const due = settleDueAt(e, await settleDeadline(env));
  const left = due === null ? null : due - at.getTime();
  const warn = left !== null && left <= SETTLE_WARN_MS;
  const slot = `${p.date}T${p.time.slice(0, 2)}:${Number(p.time.slice(3, 5)) < 30 ? "00" : "30"}`;
  await once(env, e.id, "settle_reminder", slot, async () => {
    const sent = await toManager(
      env,
      e,
      (l) =>
        message(
          l,
          bt(
            l,
            "💰 {day} 的活动已经结束，还没有结算（报名 {n} 人）。\n请打开管理页：标记没来的人，填写场地费和用球数，然后点「结算费用」。",
            { day: day(e, l), n },
          ) +
            (warn
              ? `\n${bt(l, "⚠️ 还剩不到 {h} 小时，过时没有结算会自动归档，不收费。", { h: Math.max(1, Math.ceil(left! / 3600_000)) })}`
              : ""),
        ),
      true,
    );
    try {
      // Best effort: a push that fails must not send the Telegram one again.
      if (await pushSettle(env, e, n, warn)) await sendRest(env);
    } catch (err) {
      console.error(`settle push for event ${e.id} failed:`, err);
    }
    return sent;
  });
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
    const lines = (l: BotLang) =>
      owing
        .map((x) =>
          bt(l, "{name} 还差 {amount}", { name: x.username, amount: usd(x.amount_due_cents - x.amount_paid_cents) }),
        )
        .join("\n");
    const d = await sendToManager(env, e, (l) =>
      message(
        l,
        bt(
          l,
          "📋 {day} 收款汇总：应收 {due}，已收 {paid}；已付清 {done} 人，未付清 {owing} 人：\n{lines}\n\n下面是每个人的账单提醒，可以分别复制到微信私聊。",
          {
            day: day(e, l),
            due: usd(due),
            paid: usd(paid),
            done: pays.length - owing.length,
            owing: owing.length,
            lines: lines(l),
          },
        ),
      ),
    );
    if (!d.ok) return false;
    for (const x of owing) {
      const owed = dollars(x.amount_due_cents - x.amount_paid_cents);
      // Members who joined with Google have no link: they sign in instead. With neither, the
      // Owner sends them a new link anyway, so the text doesn't name one.
      const via = x.has_link ? "通过你的专属链接" : x.has_google ? "用 Google 登录网站" : "";
      const text =
        x.status === "partial"
          ? `${x.username}，${day(e)}羽毛球的费用还差 $${owed} 没付哦，麻烦${via}补一下，谢谢！`
          : `${x.username}，${day(e)}羽毛球的费用 $${owed} 还没付哦，麻烦${via}付一下，谢谢！`;
      // Each bill reminder follows the summary, so one person gets the whole set.
      await sendLikewise(env, d, (l) =>
        message(l, bt(l, "账单提醒：{name}（微信：{wechat}）", { name: x.username, wechat: x.wechat_nickname }), text),
      );
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
    const wechat = `${day(e)}羽毛球${await runBy(env, e)}的费用已经出来了，请打开自己的专属链接（或用 Google 登录网站）查看金额并付款，谢谢！`;
    return sendToManagerAndOwner(env, e, (l) =>
      message(
        l,
        bt(l, "✅ {day} 已结算，应收合计 {total}：\n{lines}", { day: day(e, l), total: usd(total), lines }),
        wechat,
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
    const text = (l: BotLang) => {
      const t = (zh: string, vars?: Record<string, string | number>) => bt(l, zh, vars);
      const lines = [
        t("🎉 费用已全部收齐，活动已归档"),
        "",
        ...(e.title ? [t("活动：{title}", { title: e.title })] : []),
        t("日期：{date} {start}–{end}", {
          date: botDate(l, e.date),
          start: toPacific(e.start_at).time,
          end: toPacific(e.end_at).time,
        }),
        t("活动编号：{number}", { number: e.number }),
        t("场馆：{location}", { location: e.location }),
        ...(e.address ? [t("地址：{address}", { address: e.address })] : []),
      ];
      if (st) {
        const shuttle = st.shuttle_count * st.shuttle_price_cents;
        lines.push(
          t("人数：报名 {registered} 人，到场 {attended} 人（{paying} 人付款）", {
            registered: st.registered_count,
            attended: st.attended_count,
            paying: pay?.n ?? 0,
          }),
          t("费用：{amount}", { amount: usd(st.court_total_cents + shuttle) }),
          `　${t("场地费 {amount}", { amount: usd(st.court_total_cents) })}`,
          `　${t("球费 {amount}（{count} 个 × {price}）", {
            amount: usd(shuttle),
            count: st.shuttle_count,
            price: usd(st.shuttle_price_cents),
          })}`,
        );
      }
      if (pay) {
        lines.push(t("应收 {due}，实收 {paid}", { due: usd(pay.due ?? 0), paid: usd(pay.paid ?? 0) }));
        if (pay.refund) lines.push(t("还有多付的 {amount} 需要退，见管理页「收款」。", { amount: usd(pay.refund) }));
      }
      return message(l, lines.join("\n"));
    };
    return sendToManagerAndOwner(env, e, text, !!pay?.refund);
  });
}

/**
 * A Venmo payment that needs someone: 待确认 goes to whoever owns the account it went into, a
 * partial payment or an over-payment to whoever runs that event.
 */
export async function notifyPayment(
  env: Env,
  kind: "review" | "partial" | "overpaid",
  info: {
    payer: string;
    amountCents: number;
    note: string;
    reason?: string;
    paymentId?: number;
    payee?: string | null;
  },
): Promise<void> {
  if (kind === "review") {
    await sendToPayee(env, info.payee ?? null, (l) =>
      message(
        l,
        bt(
          l,
          "❓ 有一笔 Venmo 付款需要确认：{payer} {amount}，备注「{note}」。\n原因：{reason}\n请到管理页「收款」把它关联到某人名下，或者忽略。",
          { payer: info.payer, amount: usd(info.amountCents), note: info.note, reason: btm(l, info.reason ?? "") },
        ),
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
  const text = (l: BotLang) =>
    kind === "partial"
      ? bt(l, "💵 {name} 付了 {amount}（{date}），还差 {owed}。", {
          name: p.username,
          amount: usd(info.amountCents),
          date: botDate(l, p.date),
          owed: usd(p.amount_due_cents - p.amount_paid_cents),
        })
      : bt(l, "↩️ {name} 多付了 {over}（{date}，应付 {due}，共收到 {received}），需要退款，见管理页「收款」。", {
          name: p.username,
          over: usd(p.amount_paid_cents - p.amount_due_cents),
          date: botDate(l, p.date),
          due: usd(p.amount_due_cents),
          received: usd(p.amount_paid_cents + p.refunded_cents),
        });
  await sendToManager(env, p, (l) => message(l, text(l)), kind === "overpaid");
}

/**
 * 新活动发起: the Owner hears when an organizer or admin creates an event (their own, as before, send
 * nothing). The organizer isn't told about what they just did.
 */
export async function notifyCreated(env: Env, e: EventRow): Promise<void> {
  const by = await managerOf(env, e);
  if (!by) return;
  await sendToOwner(env, (l) =>
    message(
      l,
      bt(l, "🆕 {title} {name} 发起了新活动：\n{when}\n地点：{venue}\n{link}", {
        title: bt(l, by.title),
        name: by.name,
        when: when(e, l),
        venue: venue(e, l),
        link: eventLink(env, e),
      }),
    ),
  );
}
