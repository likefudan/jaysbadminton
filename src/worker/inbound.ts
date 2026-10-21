import { formatDateZh } from "../shared/time";
import type { InboundRow, OpenPayment } from "../shared/types";
import { addReceipt, checkCollected, receiptsFor, refundOf } from "./billing";
import { SYSTEM, audit, billOwner, money } from "./audit";
import { getSettings, now, setSetting } from "./db";
import { type KeyResolver, verifyDkim } from "./email/dkim";
import { isReceiptSubject, parseEmail, type VenmoReceipt } from "./email/parse";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { message, notifyPayment } from "./notify";
import { type BotLang, bt } from "./botLang";
import { eventPayee, isStaff, memberRole, ownerId } from "./organizers";
import { sendToMember, sendToOwner } from "./telegram";
import { codeName, noteName, parsePaymentCode } from "./paymentCode";
import { ownerName, payeeExpired, payeeName, payeeSql } from "./payees";
import type { RefundRow } from "../shared/types";
import { beginVenmoDiagnostic, type PaymentDiagnostic } from "./paymentDiagnostics";

export const MAX_EMAIL_BYTES = 512 * 1024;
const VENMO = "venmo@venmo.com";
const GMAIL_FORWARDING = "forwarding-noreply@google.com";

/**
 * When someone adds this address as a Gmail forwarding address, Gmail mails a confirmation code
 * here. It goes to whoever asked (design §6.3): a current organizer whose Venmo notification email
 * the message names gets it on their 收款设置 page for 24 hours, and on their Telegram if connected;
 * anyone else's goes to the Owner's Telegram, as before. Only genuine (DKIM-signed by google.com)
 * messages are passed on. `organizer` is who it went to, so it doesn't count as the Owner's email.
 */
async function gmailConfirmation(
  env: Env,
  raw: Uint8Array,
  subject: string,
  text: string,
  opts: EmailOptions,
): Promise<{ outcome: EmailOutcome; organizer: string | null }> {
  const dkim = await verifyDkim(raw, "google.com", opts.resolveKey);
  if (!dkim.ok) {
    console.warn("gmail confirmation not verified:", dkim.reason);
    return { outcome: "gmail_unverified", organizer: null };
  }
  const body = text.split("\n").slice(0, 25).join("\n").slice(0, 1500);
  const content = `${subject}\n\n${body}`;
  const organizer = await confirmationOrganizer(env, `${subject}\n${text}`);
  if (organizer) {
    await env.DB.prepare("UPDATE payment_profiles SET gmail_confirm = ?, gmail_confirm_at = ? WHERE member_id = ?")
      .bind(content, now(), organizer)
      .run();
    await sendToMember(env, organizer, (l) => gmailConfirmText(l, content));
    return { outcome: "gmail_confirm_organizer", organizer };
  }
  await sendToOwner(env, (l) => gmailConfirmText(l, content));
  return { outcome: "gmail_confirm", organizer: null };
}

const gmailConfirmText = (l: BotLang, content: string) =>
  message(
    l,
    bt(l, "📮 Gmail 转发确认邮件\n{content}\n\n把上面的确认码填到 Gmail 设置里，或打开里面的确认链接。", { content }),
  );

/** How long a Gmail confirmation stays on the organizer's 收款设置 page. */
export const GMAIL_CONFIRM_HOURS = 24;

/** The current organizer or admin whose Venmo notification email the confirmation names, if any. */
async function confirmationOrganizer(env: Env, text: string): Promise<string | null> {
  const mails = [...new Set((text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((m) => m.toLowerCase()))];
  // Any of the Owner's own addresses wins, so nobody can take their confirmation by saving one of
  // them as their Venmo notification email.
  const { venmo_email: ownerEmail } = await getSettings(env.DB, ["venmo_email"]);
  const owner = await env.DB.prepare("SELECT google_email, email FROM members WHERE is_owner = 1").first<{
    google_email: string | null;
    email: string | null;
  }>();
  const owners = [ownerEmail, owner?.google_email, owner?.email]
    .filter((m): m is string => !!m)
    .map((m) => m.toLowerCase());
  if (mails.length === 0 || mails.some((m) => owners.includes(m))) return null;
  const { results } = await env.DB.prepare(
    `SELECT m.* FROM payment_profiles p JOIN members m ON m.id = p.member_id
     WHERE p.venmo_email IN (${mails.map(() => "?").join(",")})`,
  )
    .bind(...mails)
    .all<{ id: string; is_owner: number; role: string; status: string; deleted_at: string | null }>();
  return results.find((m) => isStaff(memberRole(env, m)))?.id ?? null;
}

/** Clears Gmail confirmations older than GMAIL_CONFIRM_HOURS: they carry a working code. */
export async function purgeGmailConfirmations(env: Env, at: Date = new Date()): Promise<void> {
  await env.DB.prepare(
    "UPDATE payment_profiles SET gmail_confirm = NULL, gmail_confirm_at = NULL WHERE gmail_confirm_at < ?",
  )
    .bind(new Date(at.getTime() - GMAIL_CONFIRM_HOURS * 3600_000).toISOString())
    .run();
}

/** What happened to one email; returned for tests and logged by the email handler. */
export type EmailOutcome =
  | "too_large"
  | "not_venmo"
  | "not_receipt"
  | "bad_signature"
  | "parse_failed"
  | "wrong_recipient"
  | "duplicate"
  | "ignored" // no code of ours, or a name / event nobody in the group has
  | "paid"
  | "partial"
  | "overpaid"
  | "review"
  | "gmail_confirm" // Gmail's forwarding confirmation, passed on to the Owner's Telegram
  | "gmail_confirm_organizer" // the same for an organizer: on their 收款设置 page and Telegram
  | "gmail_unverified";

export interface EmailOptions {
  resolveKey?: KeyResolver;
}

/** Whose Venmo account a receipt went into (design §6.2). */
interface Account {
  /** The Owner's member id (null before first-time setup), or an organizer's, current or former. */
  id: string | null;
  owner: boolean;
  /** How 待确认 names it: "@username（name）". */
  label: () => Promise<string>;
}

/**
 * Both must match, the username printed in the body ("Sent to") and the one address Venmo mailed
 * it to: the Owner's settings, then organizers' 收款设置 (former organizers' too), then accounts
 * they changed in the last 60 days (payment_aliases). Null when nobody's account matches.
 */
async function receivingAccount(
  env: Env,
  sentTo: string,
  to: string[],
  diagnostic?: PaymentDiagnostic | null,
): Promise<Account | null> {
  diagnostic?.step(
    "recipient_count",
    "原始收件邮箱数量",
    to.length === 1 ? "passed" : "failed",
    to.length === 1 ? undefined : "原始 To 必须只有一个邮箱",
    String(to.length),
    "1",
  );
  if (to.length !== 1) return null;
  const mail = to[0]!;
  const { venmo_username: owner = "", venmo_email: ownerEmail = "" } = await getSettings(env.DB, [
    "venmo_username",
    "venmo_email",
  ]);
  if (owner && sentTo.toLowerCase() === owner.toLowerCase() && ownerEmail && mail === ownerEmail) {
    diagnostic?.step("recipient_username", "收款用户名", "passed", undefined, sentTo, owner);
    diagnostic?.step("recipient_email", "收款通知邮箱", "passed", undefined, mail, ownerEmail);
    return { id: await ownerId(env.DB), owner: true, label: async () => `@${sentTo}（${await ownerName(env.DB)}）` };
  }
  // The columns are COLLATE NOCASE, as the Owner's username is compared above.
  const found = await env.DB.prepare(
    `SELECT member_id FROM payment_profiles WHERE venmo_username = ?1 AND venmo_email = ?2
     UNION ALL
     SELECT member_id FROM payment_aliases WHERE venmo_username = ?1 AND venmo_email = ?2 AND until > ?3
     LIMIT 1`,
  )
    .bind(sentTo, mail, now())
    .first<{ member_id: string }>();
  if (!found) {
    if (diagnostic) {
      const { results } = await env.DB.prepare(
        `SELECT venmo_username, venmo_email FROM payment_profiles
         UNION ALL SELECT venmo_username, venmo_email FROM payment_aliases WHERE until > ?`,
      )
        .bind(now())
        .all<{ venmo_username: string | null; venmo_email: string | null }>();
      const accounts = [{ venmo_username: owner, venmo_email: ownerEmail }, ...results];
      const names = accounts.filter((a) => a.venmo_username?.toLowerCase() === sentTo.toLowerCase());
      diagnostic.step(
        "recipient_username",
        "收款用户名",
        names.length ? "passed" : "failed",
        names.length ? undefined : "收款用户名不在已登记账户中",
        sentTo,
        accounts
          .map((a) => a.venmo_username)
          .filter(Boolean)
          .join("、"),
      );
      if (names.length)
        diagnostic.step(
          "recipient_email",
          "收款通知邮箱",
          "failed",
          "用户名已识别，但原始 To 与该账户的通知邮箱不一致",
          mail,
          names.map((a) => a.venmo_email || "（未设置）").join("、"),
        );
    }
    return null;
  }
  diagnostic?.step("recipient_username", "收款用户名", "passed", "匹配到组织者当前账户或有效旧账户", sentTo);
  diagnostic?.step("recipient_email", "收款通知邮箱", "passed", undefined, mail);
  return {
    id: found.member_id,
    owner: false,
    label: async () => `@${sentTo}（${await payeeName(env.DB, found.member_id)}）`,
  };
}

/**
 * The organizer an email that could not be matched to an account was most likely forwarded by:
 * the one whose notification email (now, or within 60 days) it was addressed to. Such emails say
 * nothing about the Owner's own forwarding, and their problems are the organizer's to fix.
 */
async function mailedTo(env: Env, to: string[]): Promise<string | null> {
  if (to.length !== 1) return null;
  const { venmo_email: ownerEmail = "" } = await getSettings(env.DB, ["venmo_email"]);
  if (ownerEmail && to[0] === ownerEmail) return null;
  const r = await env.DB.prepare(
    `SELECT member_id FROM payment_profiles WHERE venmo_email = ?1
     UNION ALL SELECT member_id FROM payment_aliases WHERE venmo_email = ?1 AND until > ?2 LIMIT 1`,
  )
    .bind(to[0], now())
    .first<{ member_id: string }>();
  return r?.member_id ?? null;
}

/**
 * 转发已生效 and the 转发可能中断 check read this: a signed Venmo email reached us from the inbox of
 * their current notification email (an old account with the same email shares that inbox).
 */
const forwarded = (env: Env, memberId: string, to: string) =>
  env.DB.prepare("UPDATE payment_profiles SET email_last_at = ? WHERE member_id = ? AND venmo_email = ?")
    .bind(now(), memberId, to)
    .run();

/**
 * The Owner forwards every Venmo receipt, most of them unrelated to badminton, and so does each
 * organizer, so only notes carrying our code with a group member's name and an existing event are
 * acted on:
 * - code and person match a bill, and the money went into that event's payee's account → the
 *   payment is added to it: paid when the total reaches the amount due, 部分付款 while short, and
 *   any excess is listed under 需要退款;
 * - the event exists but the bill cannot be pinned down, or the money went into someone else's
 *   account → 待确认 for whoever owns the account it went into;
 * - everything else (no code, unknown name or event, unreadable email) is ignored and not stored.
 */
export async function handleEmail(env: Env, raw: Uint8Array, opts: EmailOptions = {}): Promise<EmailOutcome> {
  return (await receiveEmail(env, raw, opts)).outcome;
}

/**
 * handleEmail, plus the organizer (current or former) whose account the email was for, if it was
 * one's: their emails don't count toward the Owner's 转发状态.
 */
export async function receiveEmail(
  env: Env,
  raw: Uint8Array,
  opts: EmailOptions = {},
): Promise<{ outcome: EmailOutcome; organizer: string | null }> {
  const diagnostic = await beginVenmoDiagnostic(env, raw);
  try {
    const result = await processEmail(env, raw, opts, diagnostic);
    if (result.outcome !== "not_venmo" && !result.outcome.startsWith("gmail_"))
      await diagnostic?.finish(result.outcome);
    else await diagnostic?.discard();
    return result;
  } catch (err) {
    diagnostic?.error();
    await diagnostic?.finish("processing_error");
    console.error("email processing failed; diagnostic:", diagnostic?.id ?? "off", err);
    throw err;
  }
}

async function processEmail(
  env: Env,
  raw: Uint8Array,
  opts: EmailOptions,
  diagnostic: PaymentDiagnostic | null,
): Promise<{ outcome: EmailOutcome; organizer: string | null }> {
  diagnostic?.step(
    "size",
    "邮件大小",
    raw.byteLength > MAX_EMAIL_BYTES ? "failed" : "passed",
    undefined,
    `${raw.byteLength} 字节`,
    `不超过 ${MAX_EMAIL_BYTES} 字节`,
  );
  if (raw.byteLength > MAX_EMAIL_BYTES) return { outcome: "too_large", organizer: null };
  diagnostic?.step("mime", "邮件解析", "processing");
  const mail = await parseEmail(raw);
  diagnostic?.mail(mail);
  diagnostic?.step("mime", "邮件解析", "passed");
  if (mail.fromAddress === GMAIL_FORWARDING) return gmailConfirmation(env, raw, mail.subject, mail.text, opts);
  if (mail.fromAddress !== VENMO) return { outcome: "not_venmo", organizer: null };
  diagnostic?.step("sender", "发件地址", "passed", "地址匹配，邮件真实性还需签名验证", mail.fromAddress, VENMO);
  // Not matched to an account. Addressed to an organizer, it is theirs: it says nothing about the
  // Owner's forwarding. Only a signed one proves theirs works, as the To header of an unchecked
  // email proves nothing.
  const unknown = async (outcome: EmailOutcome, signed: boolean) => {
    const to = await mailedTo(env, mail.toAddresses);
    if (to && signed) await forwarded(env, to, mail.toAddresses[0]!);
    return { outcome, organizer: to };
  };
  const receiptSubject = isReceiptSubject(mail.subject);
  diagnostic?.step(
    "subject",
    "收款通知标题",
    receiptSubject ? "passed" : "failed",
    receiptSubject ? undefined : "不是支持的 Venmo 收款通知标题",
    mail.subject,
    "含 paid 或 pay，以及 $金额",
  );
  if (!receiptSubject) {
    // Other Venmo mail is never acted on, so it isn't checked; an organizer's is, as it is the
    // only sign of their forwarding on days nobody pays them.
    const to = await mailedTo(env, mail.toAddresses);
    if (to && (await verifyDkim(raw, "venmo.com", opts.resolveKey)).ok) await forwarded(env, to, mail.toAddresses[0]!);
    return { outcome: "not_receipt", organizer: to };
  }
  diagnostic?.step("dkim", "Venmo 签名验证", "processing");
  const dkim = await verifyDkim(raw, "venmo.com", opts.resolveKey);
  diagnostic?.step(
    "dkim",
    "Venmo 签名验证",
    dkim.ok ? "passed" : dkim.retryable ? "warning" : "failed",
    dkim.ok
      ? "From、To、Subject 和正文通过 Venmo 签名验证"
      : dkim.retryable
        ? `公钥查询暂时失败，不会自动入账：${dkim.reason}`
        : dkim.reason,
  );
  if (!dkim.ok && !dkim.retryable) {
    console.warn("venmo email rejected:", dkim.reason);
    // Always the Owner's: a forged email's To proves nothing, and the Owner should see it.
    return { outcome: "bad_signature", organizer: null };
  }
  // DNS was down so the signature is unchecked: never act on it, at most ask the Owner.
  const unverified = !dkim.ok;

  const r = mail.receipt;
  diagnostic?.step(
    "receipt",
    "收款字段与金额一致性",
    r ? "passed" : "failed",
    r ? undefined : mail.receiptError || "无法提取完整收款字段",
    r ? `付款人 ${r.payer}；金额 ${money(r.amountCents)}；交易 ${r.txnId}；日期 ${r.date}` : undefined,
  );
  if (!r) return unknown("parse_failed", !unverified);

  diagnostic?.step("receiving_account", "识别收款账户", "processing");
  const account = await receivingAccount(env, r.sentTo, mail.toAddresses, diagnostic);
  diagnostic?.step(
    "receiving_account",
    "识别收款账户",
    account ? "passed" : "failed",
    account ? undefined : "收款用户名或原始收件邮箱不匹配",
    account?.id ?? undefined,
  );
  if (!account) return unknown("wrong_recipient", !unverified);
  if (account.owner)
    return { outcome: await matchReceipt(env, r, mail.messageId, account, unverified, diagnostic), organizer: null };
  // Only signed emails, from the inbox of their current account (forwarded() checks the address).
  if (!unverified && account.id) await forwarded(env, account.id, mail.toAddresses[0]!);
  return {
    outcome: await matchReceipt(env, r, mail.messageId, account, unverified, diagnostic),
    organizer: account.id,
  };
}

/**
 * The bill and event a Venmo note's payment code names, or null when the note carries no code with
 * one of the group's names. First the bill whose printed code has this event number and member
 * (bills made before event numbers existed may carry another date than their event's number); then
 * the event by its fixed number, which a date edit never changes. `e` is null for a deleted event.
 */
export async function noteTarget(env: Env, note: string | null, diagnostic?: PaymentDiagnostic | null) {
  const code = note ? parsePaymentCode(note) : null;
  diagnostic?.step(
    "note_code",
    "付款备注编号",
    code?.name ? "passed" : "failed",
    code?.name ? undefined : "未识别到带名字的本群付款编号",
    note ?? "（无备注）",
    "名字-jbm年月日-m成员编号",
  );
  if (!code?.name) return null;
  diagnostic?.step("group_name", "群内名字识别", "processing");
  const knownName = await isGroupName(env, code.name);
  diagnostic?.step(
    "group_name",
    "群内名字识别",
    knownName ? "passed" : "failed",
    knownName ? "匹配当前成员名字或历史账单名字" : "名字不属于已知成员或历史账单",
    code.name ?? "",
  );
  if (!knownName) return null;
  diagnostic?.step(
    "bill_lookup",
    "按活动编号和成员编号查账单",
    "processing",
    undefined,
    `${code.number} / ${code.memberId}`,
  );
  const billed = await env.DB.prepare(
    `SELECT p.id, p.payment_code, p.event_id FROM payments p JOIN events e ON e.id = p.event_id
     WHERE p.member_id = ?1 AND instr(lower(p.payment_code), ?2) > 0
     ORDER BY '-' || e.number || '-' = ?2 DESC, p.id DESC LIMIT 1`,
  )
    .bind(code.memberId, `-${code.number}-`)
    .first<{ id: number; payment_code: string; event_id: number }>();
  diagnostic?.step(
    "bill_lookup",
    "按活动编号和成员编号查账单",
    billed ? "passed" : "warning",
    billed ? undefined : "未找到账单，继续按固定编号查活动",
    billed ? `账单 ${billed.id}` : undefined,
  );
  diagnostic?.step("event", "查找活动", "processing", undefined, code.number);
  const e = billed
    ? await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(billed.event_id).first<EventRow>()
    : await env.DB.prepare("SELECT * FROM events WHERE number = ?").bind(code.number).first<EventRow>();
  return { code, billed, e };
}

/** One verified-enough receipt into a known account: onto a bill, into 待确认, or ignored. */
async function matchReceipt(
  env: Env,
  r: VenmoReceipt,
  emailId: string,
  account: Account,
  unverified: boolean,
  diagnostic?: PaymentDiagnostic | null,
): Promise<EmailOutcome> {
  const target = await noteTarget(env, r.note, diagnostic);
  if (!target) return "ignored";
  const { code, billed, e } = target;
  // A payment for an event the Owner deleted is still a group member's money: 待确认, not ignored.
  const deleted =
    !e && (await env.DB.prepare("SELECT 1 FROM deleted_events WHERE number = ?").bind(code.number).first());
  diagnostic?.step(
    "event",
    "查找活动",
    e ? "passed" : "failed",
    e ? undefined : deleted ? "活动已永久删除" : "活动编号不存在",
    code.number,
    e ? `活动 ${e.id}（${e.status}）` : undefined,
  );
  if (!e && !deleted) return "ignored";

  diagnostic?.step("duplicate", "交易 ID 去重", "processing", undefined, r.txnId);
  const seen = await env.DB.prepare(
    "SELECT 1 FROM inbound_payments WHERE venmo_txn_id = ?1 UNION ALL SELECT 1 FROM payment_receipts WHERE venmo_txn_id = ?1",
  )
    .bind(r.txnId)
    .first();
  diagnostic?.step(
    "duplicate",
    "交易 ID 去重",
    seen ? "warning" : "passed",
    seen ? "交易已在付款记录或待确认中，不重复记账" : undefined,
    r.txnId,
  );
  if (seen) return "duplicate";

  const review = (reason: string) => {
    diagnostic?.step("manual_review", "转入待确认", "processing", reason);
    return record(env, r, emailId, reason, account.id).then((outcome) => {
      diagnostic?.step("manual_review", "转入待确认", "warning", reason);
      return outcome;
    });
  };
  if (!e) return review("这次活动已从数据库永久删除");
  // A former organizer's account still forwards: group money that lands there is the Owner's to sort out.
  diagnostic?.step("account_active", "收款账户有效性", "processing");
  const expired = !account.owner && account.id && (await payeeExpired(env.DB, account.id));
  diagnostic?.step(
    "account_active",
    "收款账户有效性",
    expired ? "failed" : "passed",
    expired ? "该账户已不再收本群款项" : undefined,
  );
  if (expired) return review(`付到了 ${await account.label()}的账户，这个账户已经不再收本群的款`);
  diagnostic?.step("event_payee", "活动指定收款人", "processing");
  const payee = await eventPayee(env.DB, e);
  diagnostic?.step(
    "event_payee",
    "活动指定收款人",
    payee === account.id ? "passed" : "failed",
    payee === account.id ? undefined : "钱进入了另一位收款人的账户",
    account.id ?? "群主",
    payee ?? "群主",
  );
  if (payee !== account.id)
    return review(`付到了 ${await account.label()}的账户，但这场的收款人是 ${await payeeName(env.DB, payee)}`);
  diagnostic?.step("bill", "成员账单", "processing", undefined, `${code.memberId} / 活动 ${e.id}`);
  const p =
    billed ??
    (await env.DB.prepare("SELECT id, payment_code FROM payments WHERE event_id = ? AND member_id = ?")
      .bind(e.id, code.memberId)
      .first<{ id: number; payment_code: string }>());
  diagnostic?.step(
    "bill",
    "成员账单",
    p ? "passed" : "failed",
    p ? undefined : `未找到应付款，活动状态为 ${e.status}`,
    p ? `账单 ${p.id}` : undefined,
  );

  if (!p) {
    if (e.status === "open" || e.status === "closed") return review("这次活动还没结算");
    if (e.status === "cancelled") return review("这次活动已取消");
    return review("编号里的成员没有这次活动的应付款");
  }
  // The code, name included, is fixed when the bill is created; a later rename does not change it.
  diagnostic?.step(
    "bill_name",
    "名字与账单编号一致性",
    code.name === codeName(p.payment_code) ? "passed" : "failed",
    undefined,
    code.name ?? "",
    codeName(p.payment_code),
  );
  if (code.name !== codeName(p.payment_code)) {
    return review(`备注里的名字和编号 ${code.memberId.toLowerCase()} 不是同一个人`);
  }
  diagnostic?.step(
    "verified",
    "允许自动入账",
    unverified ? "failed" : "passed",
    unverified ? "签名尚未验证，禁止自动入账" : undefined,
  );
  if (unverified) return review("暂时无法校验 Venmo 签名，请核对后手动关联");

  // Every payment counts toward the bill, however many there are; an archived (fully paid)
  // event can only gain an over-payment, which shows up under 需要退款.
  diagnostic?.step("ledger", "写入付款记录并重算账单", "processing");
  if (
    !(await addReceipt(env, p.id, {
      amountCents: r.amountCents,
      method: "venmo",
      txnId: r.txnId,
      payerName: r.payer,
      note: r.note,
    }))
  ) {
    diagnostic?.step("ledger", "写入付款记录并重算账单", "warning", "交易已被其他请求记账，不重复写入");
    return "duplicate";
  }
  diagnostic?.step(
    "ledger",
    "写入付款记录并重算账单",
    "passed",
    "付款已入账",
    `账单 ${p.id}，本笔 ${money(r.amountCents)}`,
  );
  diagnostic?.step("audit", "记录对账操作", "processing");
  await audit(
    env,
    e.id,
    SYSTEM,
    "auto_match",
    async () =>
      `Venmo 自动对账：${r.payer ?? "付款人不明"} 付 ${money(r.amountCents)}，记到 ${await billOwner(env, code.memberId)} 的账单`,
  );
  diagnostic?.step("audit", "记录对账操作", "passed");
  diagnostic?.step("balance", "读取入账后的账单余额", "processing");
  const after = (await env.DB.prepare("SELECT status, amount_due_cents, amount_paid_cents FROM payments WHERE id = ?")
    .bind(p.id)
    .first<{ status: string; amount_due_cents: number; amount_paid_cents: number }>())!;
  diagnostic?.step(
    "balance",
    "读取入账后的账单余额",
    "passed",
    after.status,
    `实收 ${money(after.amount_paid_cents)}`,
    `应付 ${money(after.amount_due_cents)}`,
  );
  const info = { payer: r.payer, amountCents: r.amountCents, note: r.note, paymentId: p.id };
  if (after.status === "partial") {
    diagnostic?.step("notification", "发送付款通知", "processing");
    await notifyPayment(env, "partial", info);
    diagnostic?.step("notification", "发送付款通知", "passed", "已完成通知处理；未连接通知渠道时不发送");
    return "partial";
  }
  if (e.status === "finalized") {
    diagnostic?.step("archive", "检查是否收齐归档", "processing");
    const archived = await checkCollected(env, e.id);
    diagnostic?.step(
      "archive",
      "检查是否收齐归档",
      "passed",
      archived ? "所有人付清，活动已归档" : "本次未触发归档（可能尚未付清或已被其他请求归档）",
    );
  }
  if (after.amount_paid_cents > after.amount_due_cents) {
    diagnostic?.step("notification", "发送付款通知", "processing");
    await notifyPayment(env, "overpaid", info);
    diagnostic?.step("notification", "发送付款通知", "passed", "已完成通知处理；未连接通知渠道时不发送");
    return "overpaid";
  }
  return "paid";
}

/** True when the note's name is someone's in the group, now or as printed on an earlier bill. */
async function isGroupName(env: Env, name: string): Promise<boolean> {
  const { results: members } = await env.DB.prepare("SELECT username FROM members").all<{ username: string }>();
  if (members.some((m) => noteName(m.username) === name)) return true;
  const { results: codes } = await env.DB.prepare("SELECT DISTINCT payment_code FROM payments").all<{
    payment_code: string;
  }>();
  return codes.some((c) => codeName(c.payment_code) === name);
}

async function record(
  env: Env,
  r: VenmoReceipt,
  emailId: string,
  reason: string,
  payee: string | null,
): Promise<EmailOutcome> {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO inbound_payments (venmo_txn_id, email_id, payer_name, amount_cents, note, received_at, kind, reason, payee_id)
     VALUES (?, ?, ?, ?, ?, ?, 'unmatched', ?, ?)`,
  )
    .bind(r.txnId, emailId, r.payer, r.amountCents, r.note, now(), reason, payee)
    .run();
  if (res.meta.changes === 0) return "duplicate";
  await notifyPayment(env, "review", { payer: r.payer, amountCents: r.amountCents, note: r.note, reason, payee });
  return "review";
}

const eventLabel = (date: string, code: string) =>
  formatDateZh(date) + (code.length > 4 ? ` 第${code.charCodeAt(4) - 64}场` : "");

const ROW_FILTER = {
  open: ["i.state = 'open'", "ORDER BY i.received_at DESC LIMIT 200"],
  done: ["i.state = 'linked'", "ORDER BY i.received_at DESC LIMIT 30"],
  // All of them, until deleted, so a mistaken 忽略 can always be moved back (only payments that
  // carry our code ever get here, so there are few).
  ignored: ["i.state = 'ignored'", "ORDER BY i.received_at DESC"],
  deleted: ["i.state = 'deleted'", "ORDER BY i.deleted_at DESC"],
};

/** 已删除 keeps a payment this long; then the cron removes it for good. */
export const TRASH_DAYS = 30;

export async function purgeDeletedInbound(env: Env, at: Date = new Date()): Promise<void> {
  await env.DB.prepare("DELETE FROM inbound_payments WHERE state = 'deleted' AND deleted_at < ?")
    .bind(new Date(at.getTime() - TRASH_DAYS * 86400_000).toISOString())
    .run();
}

/**
 * One list of the 收款 page. With `payee`, only payments into that person's account (an organizer's;
 * NULL is the Owner's, so never theirs).
 */
export async function inboundRows(
  env: Env,
  state: keyof typeof ROW_FILTER,
  payee: string | null = null,
): Promise<InboundRow[]> {
  const [where, order] = ROW_FILTER[state];
  const { results } = await env.DB.prepare(
    `SELECT i.*, m.username, e.date, e.code, CASE WHEN pm.is_owner = 0 THEN pm.username END AS payee_name
     FROM inbound_payments i
     LEFT JOIN members pm ON pm.id = i.payee_id
     LEFT JOIN payments p ON p.id = i.linked_payment_id
     LEFT JOIN members m ON m.id = p.member_id
     LEFT JOIN events e ON e.id = p.event_id
     WHERE ${where} ${payee ? "AND i.payee_id = ?" : ""} ${order}`,
  )
    .bind(...(payee ? [payee] : []))
    .all<Record<string, any>>();
  return results.map((i) => ({
    id: i.id,
    kind: i.kind,
    state: i.state,
    payerName: i.payer_name,
    amountCents: i.amount_cents,
    note: i.note,
    receivedAt: i.received_at,
    txnId: i.venmo_txn_id,
    reason: i.reason,
    linked: i.linked_payment_id
      ? { paymentId: i.linked_payment_id, memberName: i.username, eventLabel: eventLabel(i.date, i.code) }
      : null,
    // An organizer's own list is all their own account.
    payee: payee ? null : (i.payee_name ?? null),
    deletedAt: i.deleted_at,
  }));
}

/** How long after an event is archived its bills can still take a 待确认 payment, as an over-payment. */
export const LINK_ARCHIVED_DAYS = 60;

/**
 * Which bills a 待确认 payment may go on (bill p, member m, event e): any unpaid bill of an event
 * still collecting, and paid ones there or on an event archived lately, so someone who paid twice
 * (cash, then Venmo with a mistyped code) ends up under 需要退款, as when Venmo matches it
 * automatically. Never the payee's own (it pays itself); and of paid bills, never deleted members'
 * or $0 ones that never received anything. Bind the archive cut-off once.
 */
export const LINKABLE = `(p.member_id IS NOT ${payeeSql("e")} AND (e.status = 'finalized' AND p.status != 'paid'
  OR (e.status = 'finalized' OR (e.status = 'settled' AND e.settled_at >= ?1))
     AND p.status = 'paid' AND m.deleted_at IS NULL AND (p.amount_due_cents > 0 OR p.amount_paid_cents > 0)))`;

export const linkCutoff = (at: Date = new Date()) =>
  new Date(at.getTime() - LINK_ARCHIVED_DAYS * 86400_000).toISOString();

/**
 * The bills 待确认 offers to link to: unpaid ones first, then paid ones. With `manager`, only bills
 * of the events that person runs.
 */
export async function openPayments(env: Env, manager: string | null = null): Promise<OpenPayment[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.amount_due_cents, p.amount_paid_cents, p.status, p.payment_code, m.username, e.date, e.code
     FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id
     WHERE ${LINKABLE} ${manager ? "AND e.manager_id = ?2" : ""}
     ORDER BY p.status = 'paid', e.start_at DESC, m.username`,
  )
    .bind(linkCutoff(), ...(manager ? [manager] : []))
    .all<Record<string, any>>();
  return results.map((p) => ({
    id: p.id,
    eventLabel: eventLabel(p.date, p.code),
    memberName: p.username,
    amountDueCents: p.amount_due_cents,
    amountPaidCents: p.amount_paid_cents,
    status: p.status,
    paymentCode: p.payment_code,
  }));
}

/**
 * Bills that received more than they were due, on any event (with `manager`, the events that person
 * runs), until they are marked refunded.
 */
export async function refundRows(env: Env, manager: string | null = null): Promise<RefundRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.username, e.date, e.code FROM payments p
     JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id
     WHERE p.amount_paid_cents > p.amount_due_cents ${manager ? "AND e.manager_id = ?" : ""}
     ORDER BY e.start_at DESC, m.username`,
  )
    .bind(...(manager ? [manager] : []))
    .all<Record<string, any>>();
  const receipts = await receiptsFor(
    env,
    results.map((p) => p.id),
  );
  return results.map((p) => ({
    paymentId: p.id,
    eventLabel: eventLabel(p.date, p.code),
    memberName: p.username,
    amountDueCents: p.amount_due_cents,
    amountPaidCents: p.amount_paid_cents,
    refundCents: refundOf(p as never),
    receipts: receipts.get(p.id) ?? [],
  }));
}

const OUTCOME_ZH: Record<EmailOutcome, string> = {
  too_large: "邮件太大，已忽略",
  not_venmo: "不是 Venmo 的邮件，已忽略",
  not_receipt: "是 Venmo 的其他通知（不是收款），已忽略",
  bad_signature: "Venmo 签名校验失败，已拒绝（可能是伪造的邮件）",
  parse_failed: "Venmo 邮件格式无法识别，已忽略",
  wrong_recipient: "收款账号或收件邮箱和设置里的不一致，已忽略。请检查设置里的 Venmo 用户名和 Venmo 通知邮箱",
  duplicate: "重复的邮件，已忽略",
  ignored: "收到并验证通过；备注里没有本群付款编号，当作无关收款忽略。转发工作正常",
  paid: "收到并验证通过，已自动记账（付清）",
  partial: "收到并验证通过，已记账（部分付款）",
  overpaid: "收到并验证通过，已记账（多付，需要退款）",
  review: "收到并验证通过，已放入「待确认」",
  gmail_confirm: "收到 Gmail 转发确认邮件，已发到你的 Telegram",
  gmail_confirm_organizer: "收到组织者的 Gmail 转发确认邮件，已转给这位组织者",
  gmail_unverified: "收到自称 Gmail 转发确认的邮件，但签名校验失败，已忽略",
};

/**
 * Remembers the last email that got past the From check, for the Owner's 转发状态 line in the
 * guide, and logs it under whose account it was for (`organizer`; null is the Owner) for the
 * weekly digest. An organizer's emails don't touch the Owner's last-seen time: they say nothing
 * about the Owner's own forwarding.
 */
export async function recordEmailOutcome(
  env: Env,
  outcome: EmailOutcome,
  organizer: string | null = null,
): Promise<void> {
  if (outcome === "not_venmo" || outcome === "too_large") return; // spam and noise
  const at = now();
  const log = env.DB.prepare("INSERT INTO email_log (received_at, outcome, payee_id) VALUES (?, ?, ?)").bind(
    at,
    outcome,
    organizer,
  );
  if (organizer) {
    await log.run();
    return;
  }
  await env.DB.batch([setSetting(env.DB, "email_last_at", at), setSetting(env.DB, "email_last_outcome", outcome), log]);
}

export async function emailStatus(env: Env): Promise<{ lastAt: string | null; outcome: string | null }> {
  const s = await getSettings(env.DB, ["email_last_at", "email_last_outcome"]);
  return {
    lastAt: s.email_last_at ?? null,
    outcome: s.email_last_outcome ? (OUTCOME_ZH[s.email_last_outcome as EmailOutcome] ?? null) : null,
  };
}
