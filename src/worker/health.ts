import { toPacific } from "../shared/time";
import { type BotLang, bt, botInstant, botList, usd } from "./botLang";
import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import type { EmailOutcome } from "./inbound";
import { message, once, type NotifySettings } from "./notify";
import { sheetsStatus } from "./sheets";
import { isStaging } from "./site";
import { sendToOwner, sendToPayee, sendToPayeeAndOwner } from "./telegram";
import { ROLE_TITLE, currentStaffSql, isStaff, memberRole, ownerId } from "./organizers";
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
const ORGANIZER_PROBLEMS: Partial<Record<EmailOutcome, string>> = {
  wrong_recipient:
    "⚠️ 收到一封转发到 {name} 的 Venmo 收款邮件，但收款账号和 {name} 的收款设置里的 Venmo 用户名不一致，已忽略。\n请检查管理页「设置 › 我的收款设置」里的 Venmo 用户名和通知邮箱是否填对。",
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
    const name = m?.username ?? organizer;
    await once(env, SITE, `email_${outcome}:${organizer}`, toPacific(at).date, async () => {
      const d = await sendToPayee(env, organizer, (l) => message(l, bt(l, theirs, { name })));
      return d.ok;
    });
    return;
  }
  const text = PROBLEMS[outcome];
  if (!text) return;
  await once(env, SITE, `email_${outcome}`, toPacific(at).date, () => sendToOwner(env, (l) => message(l, bt(l, text))));
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
        sendToOwner(env, (l) =>
          message(
            l,
            bt(
              l,
              "📭 {quiet}，但还有 {owing} 笔账单没付清。\n如果最近确实有人用 Venmo 付过款，说明 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（管理页「设置 → 使用指南」第二部分）。",
              { quiet: quietFor(l, at, s.email_last_at), owing },
            ),
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
    const text = (l: BotLang) =>
      message(
        l,
        bt(
          l,
          "📭 {quiet}，但付到这个账户的账单还有 {owing} 笔没付清。\n如果最近确实有人用 Venmo 付过款，说明这个账户的 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（组织者或管理员的管理页「设置 › Venmo 邮件转发」）。",
          { quiet: quietFor(l, at, p.email_last_at, account), owing },
        ),
      );
    // Changing account starts a new quiet spell (email_last_at goes back to empty), so "never" is per account.
    const key = p.email_last_at ?? `never:${p.venmo_username}:${p.venmo_email ?? ""}`;
    await once(env, SITE, `forward_silent:${p.member_id}`, key, () => sendToPayeeAndOwner(env, p.member_id, text));
  }
}

/**
 * forwardingWatch's test for the pages (组织者 block, an organizer's 转发状态): how many bills paying
 * into this account have been out for days while no Venmo email came for it; 0 when it looks fine.
 */
export async function quietBills(env: Env, payee: string, lastAt: string | null, at: Date = new Date()) {
  return owingInto(env, payee, new Date(at.getTime() - QUIET_DAYS * DAY).toISOString(), lastAt);
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

/** "已经 N 天没收到任何 Venmo 邮件了", or "系统还没收到过 <account>的 Venmo 邮件". */
function quietFor(l: BotLang, at: Date, lastAt: string | undefined | null, account?: string): string {
  const days = lastAt ? Math.floor((at.getTime() - Date.parse(lastAt)) / DAY) : 0;
  if (account)
    return lastAt
      ? bt(l, "已经 {days} 天没收到 {account}的 Venmo 邮件了", { days, account })
      : bt(l, "系统还没收到过 {account}的 Venmo 邮件", { account });
  return lastAt ? bt(l, "已经 {days} 天没收到任何 Venmo 邮件了", { days }) : bt(l, "系统还没收到过任何 Venmo 邮件");
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
  await once(env, SITE, "weekly_digest", p.date, async () =>
    sendToOwner(env, async (l) => message(l, await digestText(env, at, l))),
  );
}

/** One account's week: its Venmo emails by outcome, open 待确认, unpaid bills and refunds owed. */
interface AccountWeek {
  mail: Map<EmailOutcome, number>;
  review: number;
  owing: { n: number; cents: number };
  refund: { n: number; cents: number };
}

/**
 * The digest, one block per payee (design §10.3: 每周简报按收款人分别统计). With nobody but the
 * Owner collecting, which is every site with the organizers flag off, it reads exactly as before:
 * the Owner's numbers, then the checks.
 */
export async function digestText(env: Env, at: Date, l: BotLang = "zh-CN"): Promise<string> {
  const t = (zh: string, vars?: Record<string, string | number>) => bt(l, zh, vars);
  const since = new Date(at.getTime() - 7 * DAY).toISOString();
  const db = env.DB;
  const owner = await ownerId(db);
  const weeks = new Map<string, AccountWeek>();
  const week = (id: string | null) => {
    const key = id ?? "";
    if (!weeks.has(key))
      weeks.set(key, { mail: new Map(), review: 0, owing: { n: 0, cents: 0 }, refund: { n: 0, cents: 0 } });
    return weeks.get(key)!;
  };
  week(owner);

  // Every query groups by the same rule: a NULL payee is the Owner. Unattributed problem emails
  // (unreadable, forged) were logged as the Owner's, as the Owner is told about them.
  const { results: mail } = await db
    .prepare(
      `SELECT ${payeeSql("l")} AS payee, outcome, COUNT(*) AS n FROM email_log l
       WHERE received_at >= ? GROUP BY payee, outcome`,
    )
    .bind(since)
    .all<{ payee: string | null; outcome: EmailOutcome; n: number }>();
  for (const m of mail) week(m.payee).mail.set(m.outcome, m.n);
  const { results: review } = await db
    .prepare(
      `SELECT ${payeeSql("i")} AS payee, COUNT(*) AS n FROM inbound_payments i WHERE state = 'open' GROUP BY payee`,
    )
    .all<{ payee: string | null; n: number }>();
  for (const r of review) week(r.payee).review = r.n;
  const { results: bills } = await db
    .prepare(
      `SELECT ${payeeSql("e")} AS payee,
         SUM(p.status IN ('unpaid', 'partial')) AS owing,
         COALESCE(SUM(CASE WHEN p.status IN ('unpaid', 'partial') THEN p.amount_due_cents - p.amount_paid_cents END), 0) AS owing_cents,
         SUM(p.amount_paid_cents > p.amount_due_cents) AS refund,
         COALESCE(SUM(CASE WHEN p.amount_paid_cents > p.amount_due_cents THEN p.amount_paid_cents - p.amount_due_cents END), 0) AS refund_cents
       FROM payments p JOIN events e ON e.id = p.event_id
       WHERE p.status IN ('unpaid', 'partial') OR p.amount_paid_cents > p.amount_due_cents
       GROUP BY payee`,
    )
    .all<{ payee: string | null; owing: number; owing_cents: number; refund: number; refund_cents: number }>();
  for (const b of bills) {
    const w = week(b.payee);
    w.owing = { n: b.owing, cents: b.owing_cents };
    w.refund = { n: b.refund, cents: b.refund_cents };
  }
  // Current organizers and admins get a block even in a quiet week, so a forwarding never set up still shows.
  const { results: people } = await db
    .prepare(
      `SELECT m.id, m.username, m.is_owner, m.role, m.status, m.deleted_at, p.venmo_username, p.email_last_at
       FROM members m LEFT JOIN payment_profiles p ON p.member_id = m.id
       WHERE m.is_owner = 0 AND (${currentStaffSql("m")} OR m.id IN (${[...weeks.keys()].map(() => "?").join(", ")}))
       ORDER BY m.username, m.id`,
    )
    .bind(...weeks.keys())
    .all<{
      id: string;
      username: string;
      is_owner: number;
      role: string;
      status: string;
      deleted_at: string | null;
      venmo_username: string | null;
      email_last_at: string | null;
    }>();
  const others = people.filter((m) => weeks.has(m.id) || isStaff(memberRole(env, m)));

  const played = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE start_at >= ? AND start_at < ? AND status != 'cancelled'")
    .bind(since, at.toISOString())
    .first<{ n: number }>();
  const s = await getSettings(db, ["email_last_at", "cron_last_error_at", "cron_last_error", "venmo_username"]);
  const sheets = await sheetsStatus(env);

  const lines = [
    `📊 ${t("每周简报（{date} 起的 7 天）", { date: botInstant(l, since).replace(/ \d\d:\d\d$/, "") })}`,
    "",
  ];
  lines.push(t("活动：举办了 {n} 场", { n: played?.n ?? 0 }));
  const ownerBlock = [
    ...weekLines(l, week(owner), t("要你处理")),
    await forwardingCheck(l, db, at, owner, s.venmo_username, s.email_last_at, t("请检查 Gmail 转发")),
  ];
  if (others.length === 0) {
    lines.push(...ownerBlock.slice(0, -1), "", ownerBlock.at(-1)!);
  } else {
    lines.push("", t("【群主（你）的账户】"), ...ownerBlock);
    for (const m of others) {
      const role = memberRole(env, m);
      const current = isStaff(role);
      lines.push(
        "",
        t("【{title} {name} 的账户】", { title: t(current ? ROLE_TITLE[role] : "历史收款人"), name: m.username }),
        ...weekLines(l, week(m.id), current ? t("由 {name} 处理", { name: m.username }) : t("要你处理")),
        await forwardingCheck(
          l,
          db,
          at,
          m.id,
          m.venmo_username,
          m.email_last_at,
          current ? t("请提醒 {name} 检查 Gmail 转发", { name: m.username }) : t("请检查这个账户的 Gmail 转发"),
        ),
      );
    }
    lines.push("");
  }

  const checks: string[] = [];
  if (s.cron_last_error_at && s.cron_last_error_at >= since)
    checks.push(
      t("⚠️ 定时任务出过错（{at}）：{error}", {
        at: botInstant(l, s.cron_last_error_at),
        error: s.cron_last_error ?? "",
      }),
    );
  else checks.push(t("✓ 定时任务：正常"));
  if (!sheets.enabled) checks.push(t("· Google 表格同步：没有开启"));
  else if (!sheets.lastSyncAt || Date.parse(sheets.lastSyncAt) < at.getTime() - 2 * DAY)
    checks.push(
      sheets.lastSyncAt
        ? t("⚠️ Google 表格同步：最近一次在 {at}，已超过 2 天", { at: botInstant(l, sheets.lastSyncAt) })
        : t("⚠️ Google 表格同步：还没同步过"),
    );
  else checks.push(t("✓ Google 表格同步：最近一次在 {at}", { at: botInstant(l, sheets.lastSyncAt) }));
  lines.push(...checks);
  return lines.join("\n");
}

/** An account's numbers. `reviewBy` says who handles its 待确认 (要你处理, or 由 某某 处理). */
function weekLines(l: BotLang, w: AccountWeek, reviewBy: string): string[] {
  const t = (zh: string, vars?: Record<string, string | number>) => bt(l, zh, vars);
  const count = (os: EmailOutcome[]) => os.reduce((t, o) => t + (w.mail.get(o) ?? 0), 0);
  const mailTotal = count(OUTCOME_GROUPS.flatMap(([, os]) => os)); // Gmail confirmations are not Venmo mail
  const lines: string[] = [];
  if (mailTotal === 0) {
    lines.push(t("Venmo 邮件：这周一封也没收到"));
  } else {
    const parts = OUTCOME_GROUPS.map(([label, os]) => [label, count(os)] as const).filter(([, n]) => n > 0);
    const kinds = botList(
      l,
      parts.map(([label, n]) => `${t(label)} ${n}`),
    );
    lines.push(t("Venmo 邮件：收到 {n} 封（{kinds}）", { n: mailTotal, kinds }));
  }
  lines.push(w.review ? t("待确认：还有 {n} 笔{by}", { n: w.review, by: reviewBy }) : t("待确认：没有"));
  lines.push(
    w.owing.n
      ? t("未付清账单：{n} 笔，共 {amount}", { n: w.owing.n, amount: usd(w.owing.cents) })
      : t("未付清账单：没有"),
  );
  if (w.refund.n) lines.push(t("待退款：{n} 笔，共 {amount}", { n: w.refund.n, amount: usd(w.refund.cents) }));
  return lines;
}

/**
 * Whether forwarding into this account works: its last Venmo email, and whether it has gone quiet
 * for days while bills paying into it are unpaid (forwardingWatch's rule, without the wait for
 * bills to be a few days old). `fix` is what to do about it.
 */
async function forwardingCheck(
  l: BotLang,
  db: D1Database,
  at: Date,
  payee: string | null,
  venmo: string | null | undefined,
  lastAt: string | null | undefined,
  fix: string,
): Promise<string> {
  if (!venmo) return bt(l, "⚠️ 收款设置还没填 Venmo 用户名");
  if (!lastAt) return bt(l, "⚠️ 邮件转发：还没收到过任何 Venmo 邮件，自动对账可能还没设置好");
  if (
    Date.parse(lastAt) < at.getTime() - QUIET_DAYS * DAY &&
    (await db
      .prepare(
        `SELECT 1 FROM payments p JOIN events e ON e.id = p.event_id
         WHERE p.status IN ('unpaid', 'partial') AND ${payeeSql("e")} IS ?`,
      )
      .bind(payee)
      .first())
  )
    return bt(l, "⚠️ 邮件转发：最近一封在 {at}，有欠款却很久没收到，{fix}", { at: botInstant(l, lastAt), fix });
  return bt(l, "✓ 邮件转发：最近一封在 {at}", { at: botInstant(l, lastAt) });
}
