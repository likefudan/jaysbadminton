import type { ApprovalEmailStatus } from "../shared/types";
import type { Env } from "./env";
import { now } from "./db";
import { requireMember, type MemberRow } from "./members";
import { escapeHtml, sendToOwner } from "./telegram";

export async function sendApplicationNotice(env: Env, m: MemberRow): Promise<boolean> {
  const lines = [
    "新成员申请待审核",
    `用户名：${m.username}`,
    `微信名：${m.wechat_nickname}`,
    m.google_email ? `Google 邮箱：${m.google_email}` : "",
    m.application_message ? `留言：${m.application_message}` : "",
    "请在管理页「待审核」处理。",
  ];
  return sendToOwner(env, escapeHtml(lines.filter(Boolean).join("\n")));
}

/** Approval remains effective even if the email provider is unavailable. Admins can retry. */
export async function sendApprovalEmail(env: Env, id: string): Promise<ApprovalEmailStatus> {
  const m = await requireMember(env, id);
  if (!m.google_sub || !m.google_email || m.status !== "active" || m.deleted_at || !m.approved_at) return "not_needed";
  if (m.approval_email_sent_at) return "sent";
  let status: ApprovalEmailStatus = "not_configured";
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    status = "failed";
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `member-approval/${id}/${m.approved_at}` },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.google_email], subject: "你的羽毛球社群申请已通过审核", text: `${m.username}，你好！\n你的入群申请已通过管理员审核。\n请使用申请时的 Google 账号登录，即可报名活动、查看自己的活动和账单。\n${new URL("/login", env.SITE_ORIGIN).href}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) status = "sent";
    } catch { /* Do not log credentials, recipient addresses or provider responses. */ }
  }
  await env.DB.prepare("UPDATE members SET approval_email_status = ?, approval_email_sent_at = COALESCE(approval_email_sent_at, ?) WHERE id = ?")
    .bind(status, status === "sent" ? now() : null, id).run();
  return status;
}
