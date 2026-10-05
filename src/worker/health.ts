import { dollars } from "../shared/settle";
import { formatInstantZh, toPacific } from "../shared/time";
import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import type { EmailOutcome } from "./inbound";
import { message, once, type NotifySettings } from "./notify";
import { sheetsStatus } from "./sheets";
import { isStaging } from "./site";
import { sendToOwner, sendToPayee, sendToPayeeAndOwner } from "./telegram";
import { ownerId } from "./organizers";
import { payeeSql } from "./payees";

/**
 * Telling the Owner when the machinery itself goes wrong: a Venmo email the system could not use,
 * forwarding that has gone quiet while money is owed, and a weekly digest. Site-wide notices use
 * event_id 0 in notification_log (NULL would not dedupe: SQLite treats NULLs as distinct).
 */
const SITE = 0;
const DAY = 24 * 3600_000;
/** How long without any Venmo email, while bills are outstanding, before forwarding looks broken. */
export const QUIET_DAYS = 3;

const PROBLEMS: Partial<Record<EmailOutcome, string>> = {
  parse_failed:
    "⚠️ 收到一封 Venmo 收款邮件，但系统读不懂它的格式（可能是 Venmo 改版了），这笔付款没有自动记账。\n请在 Venmo App 里核对最近的收款，必要时在管理页手动标记已付，并告诉网站维护者。",
  bad_signature:
    "⚠️ 收到一封自称来自 Venmo、但签名校验失败的邮件，已拒绝（可能是伪造的）。\n如果最近确实有人付款，请在 Venmo App 里核对，并在管理页手动标记已付。",
  wrong_recipient:
    "⚠️ 收到一封 Venmo 收款邮件，但收款账号或收件邮箱和「收款设置」里的不一致，已忽略。\n请检查设置里的 Venmo 用户名和 Venmo 通知邮箱是否填对。",
};

/** The same, for an email addressed to an organizer's notification email (`emailProblemAlert`). */
const ORGANIZER_PROBLEMS: Partial<Record<EmailOutcome, (name: string) => string>> = {
  wrong_recipient: (name) =>
    `⚠️ 收到一封转发到 ${name} 的 Venmo 收款邮件，但收款账号和 ${name} 的收款设置里的 Venmo 用户名不一致，已忽略。\n请检查管理页「设置 › 我的收款设置」里的 Venmo 用户名和通知邮箱是否填对。`,
};

/**
 * Right after an email is handled: a problem worth knowing about, at most once a day per kind.
 * A wrong account in an email addressed to an organizer (`organizer`, from receiveEmail) is
 * theirs to fix and goes to them (the Owner when they can't get it). The rest stay the Owner's:
 * an unreadable receipt means Venmo changed its format for everyone, and the To header of a
 * forged email proves nothing.
 */
export async function emailProblemAlert(
  env: Env,
  outcome: EmailOutcome,
  at: Date = new Date(),
  organizer: string | null = null,
): Promise<void> {
  const theirs = organizer ? ORGANIZER_PROBLEMS[outcome] : undefined;
  if (organizer && theirs) {
    const m = await env.DB.prepare("SELECT username FROM members WHERE id = ?")
      .bind(organizer)
      .first<{ username: string }>();
    const text = message(theirs(m?.username ?? organizer));
    await once(env, SITE, `email_${outcome}:${organizer}`, toPacific(at).date, async () => {
      const d = await sendToPayee(env, organizer, text);
      return d.ok;
    });
    return;
  }
  const text = PROBLEMS[outcome];
  if (!text) return;
  await once(env, SITE, `email_${outcome}`, toPacific(at).date, () => sendToOwner(env, message(text)));
}

/**
 * Daily at the bill-reminder hour, for each payee's account (design §7): bills paying into it have
 * been out for a few days, yet no Venmo email of any kind has arrived for it for as long. Most
 * likely that person's Gmail filter or forwarding stopped. Once per quiet spell (keyed by the last
 * email), so it does not nag; the weekly digest repeats the Owner's state. The Owner's account is
 * told to the Owner; a current organizer's to them (the Owner when they have no Telegram) with a
 * copy for the Owner; a former organizer's to the Owner.
 */
export async function forwardingWatch(env: Env, at: Date, cfg: NotifySettings): Promise<void> {
  if (isStaging(env)) return; // the test site never receives forwarded Venmo mail
  if (Number(toPacific(at).time.slice(0, 2)) !== cfg.dunningHour) return;
  const since = new Date(at.getTime() - QUIET_DAYS * DAY).toISOString();
  const s = await getSettings(env.DB, ["venmo_username", "email_last_at"]);
  if (s.venmo_username) {
    const owner = await ownerId(env.DB);
    const owing = await owingInto(env, owner, since, s.email_last_at);
    if (owing)
      await once(env, SITE, "forward_silent", s.email_last_at ?? "never", () =>
        sendToOwner(
          env,
          message(
            `📭 ${quietFor(at, s.email_last_at, "任何 Venmo 邮件")}，但还有 ${owing} 笔账单没付清。\n如果最近确实有人用 Venmo 付过款，说明 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（管理页「设置 → 使用指南」第二部分）。`,
          ),
        ),
      );
  }
  const { results } = await env.DB.prepare(
    `SELECT p.member_id, p.venmo_username, p.venmo_email, p.email_last_at, m.username FROM payment_profiles p
     JOIN members m ON m.id = p.member_id WHERE p.venmo_username IS NOT NULL`,
  ).all<{
    member_id: string;
    venmo_username: string;
    venmo_email: string | null;
    email_last_at: string | null;
    username: string;
  }>();
  for (const p of results) {
    const owing = await owingInto(env, p.member_id, since, p.email_last_at);
    if (!owing) continue;
    const account = `@${p.venmo_username}（${p.username}）`;
    const text = message(
      `📭 ${quietFor(at, p.email_last_at, ` ${account}的 Venmo 邮件`)}，但付到这个账户的账单还有 ${owing} 笔没付清。\n如果最近确实有人用 Venmo 付过款，说明这个账户的 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（组织者的管理页「设置 › Venmo 邮件转发」）。`,
    );
    // Changing account starts a new quiet spell (email_last_at goes back to empty), so "never" is per account.
    const key = p.email_last_at ?? `never:${p.venmo_username}:${p.venmo_email ?? ""}`;
    await once(env, SITE, `forward_silent:${p.member_id}`, key, () => sendToPayeeAndOwner(env, p.member_id, text));
  }
}

/**
 * Unpaid bills paying into `payee`'s account whose event was finalized before `since`, when that
 * account has been quiet since then (`lastAt`); 0 otherwise.
 */
async function owingInto(env: Env, payee: string | null, since: string, lastAt: string | undefined | null) {
  if (lastAt && lastAt >= since) return 0;
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payments p JOIN events e ON e.id = p.event_id
     WHERE p.status IN ('unpaid', 'partial') AND e.status = 'finalized' AND e.finalized_at <= ?1
       AND ${payeeSql("e")} IS ?2`,
  )
    .bind(since, payee)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** "已经 N 天没收到<what>了", or "系统还没收到过<what>". */
function quietFor(at: Date, lastAt: string | undefined | null, what: string): string {
  if (!lastAt) return `系统还没收到过${what}`;
  return `已经 ${Math.floor((at.getTime() - Date.parse(lastAt)) / DAY)} 天没收到${what}了`;
}

/** From every cron run, whether or not the weekly digest is on: email_log keeps 120 days. */
export async function pruneEmailLog(env: Env, at: Date = new Date()): Promise<void> {
  await env.DB.prepare("DELETE FROM email_log WHERE received_at < ?")
    .bind(new Date(at.getTime() - 120 * DAY).toISOString())
    .run();
}

/** Kept for the weekly digest: the last thing that went wrong in a scheduled run. */
export async function recordCronError(env: Env, err: unknown): Promise<void> {
  try {
    const text = err instanceof Error ? err.message : String(err);
    await env.DB.batch([
      setSetting(env.DB, "cron_last_error_at", now()),
      setSetting(env.DB, "cron_last_error", text.slice(0, 200)),
    ]);
  } catch {
    // Recording must never turn one failure into two.
  }
}

const OUTCOME_GROUPS: [string, EmailOutcome[]][] = [
  ["自动记账", ["paid"]],
  ["部分付款", ["partial"]],
  ["多付", ["overpaid"]],
  ["待确认", ["review"]],
  ["无关收款（已忽略）", ["ignored", "not_receipt", "duplicate"]],
  ["异常", ["parse_failed", "bad_signature", "wrong_recipient"]],
];

/** Monday at the bill-reminder hour: how the past week went and whether everything still works. */
export async function weeklyDigest(env: Env, at: Date, cfg: NotifySettings): Promise<void> {
  const p = toPacific(at);
  if (!cfg.weeklyDigest || p.weekday !== 1 || Number(p.time.slice(0, 2)) !== cfg.dunningHour) return;
  await once(env, SITE, "weekly_digest", p.date, async () => sendToOwner(env, message(await digestText(env, at))));
}

export async function digestText(env: Env, at: Date): Promise<string> {
  const since = new Date(at.getTime() - 7 * DAY).toISOString();
  const db = env.DB;

  const { results: mail } = await db
    .prepare("SELECT outcome, COUNT(*) AS n FROM email_log WHERE received_at >= ? GROUP BY outcome")
    .bind(since)
    .all<{ outcome: EmailOutcome; n: number }>();
  const count = (os: EmailOutcome[]) => mail.filter((m) => os.includes(m.outcome)).reduce((t, m) => t + m.n, 0);
  const mailTotal = count(OUTCOME_GROUPS.flatMap(([, os]) => os)); // Gmail confirmations are not Venmo mail
  const played = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE start_at >= ? AND start_at < ? AND status != 'cancelled'")
    .bind(since, at.toISOString())
    .first<{ n: number }>();
  const review = await db
    .prepare("SELECT COUNT(*) AS n FROM inbound_payments WHERE state = 'open'")
    .first<{ n: number }>();
  const owing = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_due_cents - amount_paid_cents), 0) AS cents
       FROM payments WHERE status IN ('unpaid', 'partial')`,
    )
    .first<{ n: number; cents: number }>();
  const refund = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_paid_cents - amount_due_cents), 0) AS cents
       FROM payments WHERE amount_paid_cents > amount_due_cents`,
    )
    .first<{ n: number; cents: number }>();
  const s = await getSettings(db, ["email_last_at", "cron_last_error_at", "cron_last_error", "venmo_username"]);
  const sheets = await sheetsStatus(env);

  const lines = [`📊 每周简报（${formatInstantZh(since).split(" ").slice(0, 2).join(" ")} 起的 7 天）`, ""];
  lines.push(`活动：举办了 ${played?.n ?? 0} 场`);
  if (mailTotal === 0) {
    lines.push("Venmo 邮件：这周一封也没收到");
  } else {
    const parts = OUTCOME_GROUPS.map(([label, os]) => [label, count(os)] as const).filter(([, n]) => n > 0);
    lines.push(`Venmo 邮件：收到 ${mailTotal} 封（${parts.map(([l, n]) => `${l} ${n}`).join("，")}）`);
  }
  lines.push(`待确认：${review?.n ? `还有 ${review.n} 笔要你处理` : "没有"}`);
  lines.push(`未付清账单：${owing?.n ? `${owing.n} 笔，共 $${dollars(owing.cents)}` : "没有"}`);
  if (refund?.n) lines.push(`待退款：${refund.n} 笔，共 $${dollars(refund.cents)}`);
  lines.push("");

  const checks: string[] = [];
  if (!s.venmo_username) checks.push("⚠️ 收款设置还没填 Venmo 用户名");
  else if (!s.email_last_at) checks.push("⚠️ 邮件转发：还没收到过任何 Venmo 邮件，自动对账可能还没设置好");
  else if (
    Date.parse(s.email_last_at) < at.getTime() - QUIET_DAYS * DAY &&
    // Only the Owner's own bills: organizers' are paid into accounts with their own forwarding.
    (await db
      .prepare(
        `SELECT 1 FROM payments p JOIN events e ON e.id = p.event_id
         WHERE p.status IN ('unpaid', 'partial') AND ${payeeSql("e")} IS ?`,
      )
      .bind(await ownerId(db))
      .first())
  )
    checks.push(`⚠️ 邮件转发：最近一封在 ${formatInstantZh(s.email_last_at)}，有欠款却很久没收到，请检查 Gmail 转发`);
  else checks.push(`✓ 邮件转发：最近一封在 ${formatInstantZh(s.email_last_at)}`);
  if (s.cron_last_error_at && s.cron_last_error_at >= since)
    checks.push(`⚠️ 定时任务出过错（${formatInstantZh(s.cron_last_error_at)}）：${s.cron_last_error}`);
  else checks.push("✓ 定时任务：正常");
  if (!sheets.enabled) checks.push("· Google 表格同步：没有开启");
  else if (!sheets.lastSyncAt || Date.parse(sheets.lastSyncAt) < at.getTime() - 2 * DAY)
    checks.push(
      `⚠️ Google 表格同步：${sheets.lastSyncAt ? `最近一次在 ${formatInstantZh(sheets.lastSyncAt)}，已超过 2 天` : "还没同步过"}`,
    );
  else checks.push(`✓ Google 表格同步：最近一次在 ${formatInstantZh(sheets.lastSyncAt)}`);
  lines.push(...checks);
  return lines.join("\n");
}
