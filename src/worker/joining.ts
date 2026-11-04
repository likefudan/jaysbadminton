import { sendApplicationNotice, sendApprovalEmail } from "./approvalEmail";
import { groupAudit } from "./audit";
import { getSettings } from "./db";
import type { Env } from "./env";
import { assertPendingRoom, createMember, type MemberRow } from "./members";
import { DEFAULT_AUTO_JOINS_PER_DAY, checkAutoJoinCap } from "../shared/rules";
import type { ApprovalEmailStatus } from "../shared/types";

/**
 * 入群不需要审核 (Ke Li 2026-11-03): a 设置 switch for the Owner and admins, per site, off by default.
 * While it is on, 申请加入 with Google makes an active member at once; one email is still one member.
 */
export async function autoJoinEnabled(env: Env): Promise<boolean> {
  return (await getSettings(env.DB, ["auto_join"])).auto_join === "1";
}

/** 每天最多自动通过几人: the saved number, or 20 when none (or a broken one) is saved. */
export async function autoJoinCap(env: Env): Promise<number> {
  const n = Number((await getSettings(env.DB, ["auto_join_cap"])).auto_join_cap);
  return checkAutoJoinCap(n) ? DEFAULT_AUTO_JOINS_PER_DAY : n;
}

async function autoJoinNow(env: Env): Promise<boolean> {
  if (!(await autoJoinEnabled(env))) return false;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM group_audit WHERE action = 'auto_join' AND at > ?")
    .bind(since)
    .first<{ n: number }>();
  return (row?.n ?? 0) < (await autoJoinCap(env));
}

export interface JoinResult {
  member: MemberRow;
  /** True when 入群不需要审核 let them straight in. */
  approved: boolean;
  /** The welcome email (「用 Google 登录」), only when approved. */
  emailStatus?: ApprovalEmailStatus;
}

/** 申请加入 with Google, the only way in for new members since 用邮箱注册 went (2026-11-04). */
export async function applyToJoin(
  env: Env,
  input: { username: string; wechatNickname: string; message: string; googleSub: string; googleEmail: string },
): Promise<JoinResult> {
  const approved = await autoJoinNow(env);
  if (!approved) await assertPendingRoom(env);
  const member = await createMember(env, { ...input, status: approved ? "active" : "pending" });
  let emailStatus: ApprovalEmailStatus | undefined;
  if (approved) {
    await groupAudit(env, { memberId: member.id }, "auto_join", member.id, `${member.username} 入群（入群不需要审核）`);
    // As if approved by hand: told by email to sign in with Google.
    try {
      emailStatus = await sendApprovalEmail(env, member.id);
    } catch {
      emailStatus = "failed"; // they are in all the same and can just sign in
    }
  }
  try {
    await sendApplicationNotice(env, member, approved);
  } catch {
    /* The admin pages remain authoritative if Telegram is unavailable. */
  }
  return { member, approved, emailStatus };
}
