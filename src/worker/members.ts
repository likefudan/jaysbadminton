import type { MemberStatus, MemberSummary } from "../shared/types";
import { checkEmail, checkMessage, checkNickname, checkUsername } from "../shared/rules";
import { decryptToken, encryptToken, randomToken, sha256 } from "./lib/crypto";
import { now } from "./db";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";

export interface MemberRow {
  id: string;
  username: string;
  wechat_nickname: string;
  status: MemberStatus;
  token_hash: string | null;
  token_enc: string | null;
  is_owner: number;
  requested_at: string;
  approved_at: string | null;
  deleted_at: string | null;
  google_sub: string | null;
  google_email: string | null;
  applicant_name: string | null;
  wechat_account: string | null;
  application_message: string | null;
  approval_email_status: string | null;
  approval_email_sent_at: string | null;
  email: string | null;
  admin_note: string | null;
  link_resent_at: string | null;
}

export const toSummary = (m: MemberRow): MemberSummary => ({
  id: m.id,
  username: m.username,
  wechatNickname: m.wechat_nickname,
  status: m.status,
  isOwner: m.is_owner === 1,
  requestedAt: m.requested_at,
  approvedAt: m.approved_at,
  deletedAt: m.deleted_at,
  hasLink: !!m.token_enc,
  googleEmail: m.google_sub ? m.google_email : null,
  email: m.email,
  adminNote: m.admin_note ?? "",
  applicantName: m.applicant_name ?? "",
  wechatAccount: m.wechat_account ?? "",
  applicationMessage: m.application_message ?? "",
  approvalEmailStatus: m.approval_email_status ?? null,
  owingCents: 0,
});

export const memberLink = (origin: string, token: string) => `${origin}/m/${token}`;

export function validateNames(username: string, wechatNickname: string): void {
  const err = checkUsername(username) ?? checkNickname(wechatNickname);
  if (err) throw badRequest(err);
}

export async function usernameTaken(env: Env, username: string, exceptId?: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM members WHERE username = ? AND id IS NOT ?")
    .bind(username.trim(), exceptId ?? null)
    .first();
  return !!row;
}

/** A bot that gets past the honeypot can still only fill the 待审核 queue up to this many. */
export const MAX_PENDING = 30;

export async function assertPendingRoom(env: Env): Promise<void> {
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'pending'").first<{
    n: number;
  }>();
  if ((pending?.n ?? 0) >= MAX_PENDING) {
    throw new HttpError(429, "too_many_pending", "现在待审核的申请太多了，请先联系管理员处理后再提交");
  }
}

/**
 * One email address is one person, like one Google account: no other live member (pending
 * included) may hold it as their email or Google email. Case doesn't matter.
 */
export async function emailTaken(env: Env, email: string, exceptId?: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM members WHERE deleted_at IS NULL AND id IS NOT ?
       AND (lower(email) = lower(?) OR (google_sub IS NOT NULL AND lower(google_email) = lower(?))) LIMIT 1`,
  )
    .bind(exceptId ?? null, email.trim(), email.trim())
    .first();
  return !!row;
}

const takenError = () => new HttpError(409, "username_taken", "这个用户名已被使用，请换一个");

/** Inserts a member with the next never-reused ID. */
export async function createMember(
  env: Env,
  input: {
    username: string;
    wechatNickname: string;
    status: MemberStatus;
    isOwner?: boolean;
    googleSub?: string;
    googleEmail?: string;
    message?: string;
    email?: string;
  },
): Promise<MemberRow> {
  validateNames(input.username, input.wechatNickname);
  const messageError = checkMessage(input.message ?? "");
  if (messageError) throw badRequest(messageError);
  if (input.email !== undefined) {
    const emailError = checkEmail(input.email);
    if (emailError) throw badRequest(emailError);
    if (await emailTaken(env, input.email))
      throw new HttpError(409, "email_taken", "这个邮箱已经注册过了。已经是成员的话，可以用「找回我的专属链接」");
  }
  if (await usernameTaken(env, input.username)) throw takenError();
  const seq = await env.DB.prepare(
    "UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'next_member_seq' RETURNING value",
  ).first<{ value: number }>();
  if (!seq) throw new HttpError(500, "misconfigured", "成员编号计数器缺失");
  const id = `M${String(seq.value).padStart(3, "0")}`;
  const ts = now();
  try {
    await env.DB.prepare(
      `INSERT INTO members (id, username, wechat_nickname, status, is_owner, requested_at, approved_at, google_sub, google_email, application_message, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.username.trim(),
        input.wechatNickname.trim(),
        input.status,
        input.isOwner ? 1 : 0,
        ts,
        input.status === "active" ? ts : null,
        input.googleSub ?? null,
        input.googleEmail ?? null,
        input.message?.trim() || null,
        input.email?.trim() || null,
      )
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw takenError();
    throw e;
  }
  return (await getMember(env, id))!;
}

export async function getMember(env: Env, id: string): Promise<MemberRow | null> {
  return env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<MemberRow>();
}

export async function requireMember(env: Env, id: string): Promise<MemberRow> {
  const m = await getMember(env, id);
  if (!m) throw new HttpError(404, "member_not_found", "找不到这个成员");
  return m;
}

/** Issues a fresh link token for a member; any previous link stops working. */
export async function issueMemberToken(env: Env, id: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("UPDATE members SET token_hash = ?, token_enc = ? WHERE id = ?")
    .bind(await sha256(token), await encryptToken(token, env.TOKEN_KEY), id)
    .run();
  return token;
}

export async function revealMemberToken(env: Env, m: MemberRow): Promise<string> {
  if (m.deleted_at || m.status === "pending" || !m.token_enc)
    throw new HttpError(409, "no_link", "这个成员目前没有有效链接");
  return decryptToken(m.token_enc, env.TOKEN_KEY);
}

export async function memberByToken(env: Env, token: string): Promise<MemberRow | null> {
  // Disabled members keep their link so they can still pay what they owe; deleted ones do not.
  return env.DB.prepare(
    "SELECT * FROM members WHERE token_hash = ? AND status IN ('active', 'inactive') AND deleted_at IS NULL",
  )
    .bind(await sha256(token))
    .first<MemberRow>();
}

export async function renameMember(env: Env, m: MemberRow, username: string): Promise<void> {
  validateNames(username, m.wechat_nickname);
  if (await usernameTaken(env, username, m.id)) throw takenError();
  await env.DB.prepare("UPDATE members SET username = ? WHERE id = ?").bind(username.trim(), m.id).run();
}
