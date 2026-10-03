import type { ActivityDay, MemberProfile } from "../shared/types";
import { toPacific } from "../shared/time";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { emailTaken, type MemberRow } from "./members";
import { checkEmail } from "../shared/rules";

/** How far back the activity map goes (GitHub-style: about a year). */
export const ACTIVITY_DAYS = 371;
export const NOTE_MAX = 40;

/**
 * 个人信息: the basics plus one entry per event the member signed up for themselves (friends
 * don't count; cancelled events are left out). Ended events are 参加 or 缺席 by attendance
 * (attendance is marked at settlement); events still ahead are 已报名.
 */
export async function memberProfile(env: Env, m: MemberRow, at: Date = new Date()): Promise<MemberProfile> {
  const since = toPacific(new Date(at.getTime() - ACTIVITY_DAYS * 86400_000)).date;
  const { results } = await env.DB.prepare(
    `SELECT e.date, e.code, e.title, e.location, e.end_at, r.attended
     FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE r.member_id = ? AND r.friend_index = 0 AND e.status != 'cancelled' AND e.date >= ?
     ORDER BY e.start_at`,
  )
    .bind(m.id, since)
    .all<{ date: string; code: string; title: string; location: string; end_at: string; attended: number }>();
  const activity: ActivityDay[] = results.map((r) => ({
    date: r.date,
    code: r.code,
    title: r.title,
    location: r.location,
    status: r.end_at > at.toISOString() ? "upcoming" : r.attended ? "done" : "absent",
  }));
  return {
    id: m.id,
    username: m.username,
    wechatNickname: m.wechat_nickname,
    email: m.email || m.google_email || null,
    emailFromGoogle: !m.email && !!m.google_email,
    joinedAt: m.approved_at ?? m.requested_at,
    activity,
  };
}

/** Empty clears it (the Google email shows again, if there is one). */
export async function setMemberEmail(env: Env, m: MemberRow, raw: string): Promise<void> {
  const email = raw.trim();
  if (email) {
    const err = checkEmail(email);
    if (err) throw badRequest(err);
    if (await emailTaken(env, email, m.id)) throw new HttpError(409, "email_taken", "这个邮箱已经被其他成员使用了");
  }
  await env.DB.prepare("UPDATE members SET email = ? WHERE id = ?")
    .bind(email || null, m.id)
    .run();
}

export async function setAdminNote(env: Env, m: MemberRow, raw: string): Promise<void> {
  const note = raw.trim();
  if ([...note].length > NOTE_MAX) throw badRequest(`备注最多 ${NOTE_MAX} 个字`);
  await env.DB.prepare("UPDATE members SET admin_note = ? WHERE id = ?")
    .bind(note || null, m.id)
    .run();
}
