import { sendApplicationNotice, sendApprovalEmail } from "./approvalEmail";
import { groupAudit } from "./audit";
import { getSettings } from "./db";
import type { Env } from "./env";
import { assertPendingRoom, createMember, issueMemberToken, type MemberRow } from "./members";
import { MAX_AUTO_JOINS_PER_DAY } from "../shared/rules";
import type { ApprovalEmailStatus } from "../shared/types";

/**
 * 入群不需要审核 (Ke Li 2026-11-03): a 设置 switch for the Owner and admins, per site, off by default.
 * While it is on, 申请加入 (email or Google) makes an active member at once. Turnstile, the honeypot
 * and one-email-one-member still apply.
 */
export async function autoJoinEnabled(env: Env): Promise<boolean> {
  return (await getSettings(env.DB, ["auto_join"])).auto_join === "1";
}

async function autoJoinNow(env: Env): Promise<boolean> {
  if (!(await autoJoinEnabled(env))) return false;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM group_audit WHERE action = 'auto_join' AND at > ?")
    .bind(since)
    .first<{ n: number }>();
  return (row?.n ?? 0) < MAX_AUTO_JOINS_PER_DAY;
}

export interface JoinResult {
  member: MemberRow;
  /** True when 入群不需要审核 let them straight in. */
  approved: boolean;
  /** The welcome email (link or 「用 Google 登录」), only when approved and they gave an address. */
  emailStatus?: ApprovalEmailStatus;
}

/** 申请加入, from 用邮箱注册 and from Google alike. */
export async function applyToJoin(
  env: Env,
  input: { username: string; wechatNickname: string; message: string } & (
    | { email: string }
    | { googleSub: string; googleEmail: string }
  ),
): Promise<JoinResult> {
  const approved = await autoJoinNow(env);
  if (!approved) await assertPendingRoom(env);
  const member = await createMember(env, { ...input, status: approved ? "active" : "pending" });
  let emailStatus: ApprovalEmailStatus | undefined;
  if (approved) {
    await groupAudit(env, { memberId: member.id }, "auto_join", member.id, `${member.username} 入群（入群不需要审核）`);
    // As if approved by hand: an email applicant gets their link, a Google one is told to sign in.
    if (!member.google_sub) await issueMemberToken(env, member.id);
    try {
      emailStatus = await sendApprovalEmail(env, member.id);
    } catch {
      emailStatus = "failed"; // they are in all the same; 找回我的专属链接 or 成员 can resend it
    }
  }
  try {
    await sendApplicationNotice(env, member, approved);
  } catch {
    /* The admin pages remain authoritative if Telegram is unavailable. */
  }
  return { member, approved, emailStatus };
}
