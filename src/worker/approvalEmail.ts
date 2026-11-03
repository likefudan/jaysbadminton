import type { ApprovalEmailStatus } from "../shared/types";
import type { Env } from "./env";
import { now } from "./db";
import { memberLink, requireMember, revealMemberToken, type MemberRow } from "./members";
import { type BotLang, bt } from "./botLang";
import { escapeHtml, sendToAdmins, sendToOwner } from "./telegram";

/**
 * 新成员申请: to the Owner and every admin (Ke Li 2026-10-15); sent once anyone got it. `joined`:
 * 入群不需要审核 already let them in, so the notice says so instead of asking for a review.
 */
export async function sendApplicationNotice(env: Env, m: MemberRow, joined = false): Promise<boolean> {
  const text = (l: BotLang) => {
    const lines = [
      bt(l, joined ? "新成员已入群（入群不需要审核）" : "新成员申请待审核"),
      bt(l, "用户名：{name}", { name: m.username }),
      bt(l, "微信名：{name}", { name: m.wechat_nickname }),
      m.google_email
        ? bt(l, "Google 邮箱：{email}", { email: m.google_email })
        : m.email
          ? bt(l, "邮箱：{email}", { email: m.email })
          : "",
      m.application_message ? bt(l, "留言：{message}", { message: m.application_message }) : "",
      bt(l, joined ? "不认识的话，可以在管理页「成员」里停用。" : "请在管理页「待审核」处理。"),
    ];
    return escapeHtml(lines.filter(Boolean).join("\n"));
  };
  const [owner, admins] = await Promise.all([sendToOwner(env, text), sendToAdmins(env, text)]);
  return owner || admins;
}

export type SendResult = "sent" | "failed" | "not_configured";

/** One plain-text email through Resend. Never logs credentials, addresses or provider responses. */
export async function sendEmail(
  env: Env,
  mail: { to: string; subject: string; text: string; key: string },
): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return "not_configured";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.key,
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export const site = (env: Env, path: string) => new URL(path, env.SITE_ORIGIN).href;
export const SPAM_HINT = "如果没在收件箱里找到我们的邮件，请看一下垃圾邮件文件夹。";

/** The member's own link, written for someone who registered with email (or asked for it again). */
function linkEmailText(m: MemberRow, link: string, intro: string): string {
  return `${m.username}，你好！\n${intro}\n\n你的专属链接：\n${link}\n\n以后报名活动、查看账单都用这个链接，在微信里也能直接打开。请收藏好，不要转发给别人：拿到链接的人可以用你的身份报名。\n链接丢了的话，可以在网站的「登录 / 注册」页点「找回我的专属链接」。\n\n${SPAM_HINT}`;
}

/**
 * 审核通过的通知: Google applicants are told to sign in with Google; email applicants get their
 * link. Approval stands even if the email can't be sent; the admin can retry from 成员.
 */
export async function sendApprovalEmail(env: Env, id: string): Promise<ApprovalEmailStatus> {
  const m = await requireMember(env, id);
  if (m.status !== "active" || m.deleted_at || !m.approved_at) return "not_needed";
  const to = m.google_sub ? m.google_email : m.email;
  if (!to || (!m.google_sub && !m.token_enc)) return "not_needed";
  if (m.approval_email_sent_at) return "sent";
  const mail = m.google_sub
    ? {
        subject: "你的羽毛球社群申请已通过审核",
        text: `${m.username}，你好！\n你的入群申请已通过审核。\n请使用申请时的 Google 账号登录，即可报名活动、查看自己的活动和账单。\n${site(env, "/login")}`,
      }
    : {
        subject: "你的羽毛球群专属链接",
        text: linkEmailText(
          m,
          memberLink(new URL(env.SITE_ORIGIN).origin, await revealMemberToken(env, m)),
          "你的入群申请已通过审核。",
        ),
      };
  const status = await sendEmail(env, { to, ...mail, key: `member-approval/${id}/${m.approved_at}` });
  await env.DB.prepare(
    "UPDATE members SET approval_email_status = ?, approval_email_sent_at = COALESCE(approval_email_sent_at, ?) WHERE id = ?",
  )
    .bind(status, status === "sent" ? now() : null, id)
    .run();
  return status;
}

const RECOVERY_GAP_MS = 3600_000;

/**
 * 找回我的专属链接: if the address belongs to an approved member, mail them their link (or, for a
 * Google-only member, how to sign in). At most once an hour per member. The caller always answers
 * the same way, so nobody can use this to find out who is a member.
 */
export async function sendLinkRecovery(env: Env, email: string): Promise<void> {
  const m = await env.DB.prepare(
    `SELECT * FROM members WHERE deleted_at IS NULL AND status IN ('active', 'inactive')
       AND (lower(email) = lower(?) OR (google_sub IS NOT NULL AND lower(google_email) = lower(?))) LIMIT 1`,
  )
    .bind(email.trim(), email.trim())
    .first<MemberRow>();
  if (!m) return;
  const at = Date.now();
  if (m.link_resent_at && at - Date.parse(m.link_resent_at) < RECOVERY_GAP_MS) return;
  if (!m.token_enc && !m.google_sub) return; // nothing to send; the admin can make a link
  await env.DB.prepare("UPDATE members SET link_resent_at = ? WHERE id = ?")
    .bind(new Date(at).toISOString(), m.id)
    .run();
  const to = email.trim();
  const mail = m.token_enc
    ? {
        subject: "你的羽毛球群专属链接",
        text: linkEmailText(
          m,
          memberLink(new URL(env.SITE_ORIGIN).origin, await revealMemberToken(env, m)),
          "你刚才在网站上申请找回专属链接。",
        ),
      }
    : {
        subject: "如何登录羽毛球群网站",
        text: `${m.username}，你好！\n你刚才在网站上申请找回专属链接。你的账号用 Google 登录，不需要专属链接：\n${site(env, "/login")}\n用 ${m.google_email} 这个 Google 账号登录即可。\n\n${SPAM_HINT}`,
      };
  await sendEmail(env, { to, ...mail, key: `link-recovery/${m.id}/${Math.floor(at / RECOVERY_GAP_MS)}` });
}
