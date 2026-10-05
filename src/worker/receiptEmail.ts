import { formatDateZh } from "../shared/time";
import { money } from "./audit";
import { sendEmail, site, type SendResult } from "./approvalEmail";
import type { Env } from "./env";
import { ownerId } from "./organizers";

/**
 * 付款回执: once a payment is on someone's bill (a Venmo payment auto-matched from the receiving
 * account's forwarded email or linked from 待确认, or 标记已付 by hand), the bill's member is told by
 * email that the person who received it has it (whose account a Venmo payment went into; the
 * event's payee for 标记已付), and where the bill stands now: paid in full, still short (and by how
 * much), or over-paid (the difference will be refunded). Skipped
 * when the member has no email; a failed send is not retried, as the payment itself went through.
 * `ref` names the payment (its Venmo transaction, or "manual") so a retried request never mails twice.
 */
export async function sendPaymentReceipt(
  env: Env,
  paymentId: number,
  receipt: { amountCents: number; venmo: boolean; payer: string | null; ref: string; receiver: string | null },
): Promise<SendResult | "not_needed"> {
  try {
    const p = await env.DB.prepare(
      `SELECT p.amount_due_cents, p.amount_paid_cents, e.date, e.title,
         m.username, m.email, m.google_sub, m.google_email, m.deleted_at
       FROM payments p JOIN events e ON e.id = p.event_id JOIN members m ON m.id = p.member_id WHERE p.id = ?`,
    )
      .bind(paymentId)
      .first<{
        amount_due_cents: number;
        amount_paid_cents: number;
        date: string;
        title: string;
        username: string;
        email: string | null;
        google_sub: string | null;
        google_email: string | null;
        deleted_at: string | null;
      }>();
    if (!p || p.deleted_at) return "not_needed";
    // Where the site mails them otherwise (sendApprovalEmail).
    const to = (p.google_sub ? p.google_email : p.email)?.trim();
    if (!to) return "not_needed";
    const receiverId = receipt.receiver ?? (await ownerId(env.DB));
    const receiver = receiverId
      ? await env.DB.prepare("SELECT username FROM members WHERE id = ?").bind(receiverId).first<{ username: string }>()
      : null;
    const who = receiver?.username ?? "群主";
    const event = `${formatDateZh(p.date)}${p.title ? ` ${p.title}` : ""}`;
    const due = p.amount_due_cents;
    // Net of refunds already sent back, as syncPayments keeps it.
    const paid = p.amount_paid_cents;
    const standing =
      paid < due
        ? `这场活动你应付 ${money(due)}，目前共收到 ${money(paid)}，还差 ${money(due - paid)}，请按账单上的付款方式补齐。`
        : paid > due
          ? `这场活动你应付 ${money(due)}，目前共收到 ${money(paid)}，多付了 ${money(paid - due)}，多付的钱会退给你。`
          : `这场活动你应付 ${money(due)}，已全部付清，谢谢！`;
    const text = [
      `${p.username}，你好！`,
      `活动组织人 ${who} 已收到你的${receipt.venmo ? " Venmo " : ""}付款 ${money(receipt.amountCents)}（${event}${receipt.payer ? `，Venmo 付款人：${receipt.payer}` : ""}）。`,
      standing,
      "",
      p.google_sub ? `查看账单：用 Google 账号登录 ${site(env, "/login")}` : "查看账单：打开你的专属链接。",
      "",
      "这封邮件由系统自动发送，请不要直接回复。",
    ].join("\n");
    return await sendEmail(env, {
      to,
      subject: `已收到你的${receipt.venmo ? " Venmo " : ""}付款 ${money(receipt.amountCents)}`,
      text,
      // The standing is in the key too: a payment linked again after an undo gets its own email.
      key: `payment-receipt/${paymentId}/${receipt.ref}/${paid}/${due}`,
    });
  } catch (err) {
    console.error("payment receipt email failed", err);
    return "failed";
  }
}
