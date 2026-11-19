import type { AttendanceDetail, AttendanceStat, AttendanceWindow, MemberAttendanceResponse } from "../shared/types";
import { ACTIVE_DAYS, QUIET_DAYS } from "../shared/attendance";
import { toPacific } from "../shared/time";
import type { Env } from "./env";

/**
 * 出勤统计 on the 成员 tab (Ke Li 2026-11-19, option A): how often each member comes, so the
 * Owner and admins can see who is active and who has gone quiet.
 *
 * - An event counts as held once it has started and isn't cancelled (settled or not: people came).
 * - 参加: their own sign-up (friend_index 0, a brought member's too) not marked absent.
 * - 出勤率: 参加 ÷ events held in the window since they joined (approved_at), so newcomers aren't
 *   pulled down by events before their time.
 * - 活跃 / 少来 / 不活跃 come from the last time they came at all, whatever the window
 *   (shared/attendance.ts): a busy week of events would make the rate look low for regulars.
 */

export const WINDOWS: readonly AttendanceWindow[] = ["30", "90", "year", "all"];

export const parseWindow = (v: string | undefined): AttendanceWindow =>
  WINDOWS.includes(v as AttendanceWindow) ? (v as AttendanceWindow) : "90";

/** Pacific "YYYY-MM-DD" `days` before `date`. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both Pacific "YYYY-MM-DD"). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The first day the window covers, or "" for 全部. Today counts as one of the 30 / 90 days. */
export function windowStart(w: AttendanceWindow, today: string): string {
  if (w === "all") return "";
  if (w === "year") return `${today.slice(0, 4)}-01-01`;
  return daysBefore(today, Number(w) - 1);
}

/** The day they joined, in Pacific time: approved_at, or when they applied for the oldest members. */
const joinedOn = (m: { approved_at: string | null; requested_at: string }) =>
  toPacific(m.approved_at ?? m.requested_at).date;

interface HeldEvent {
  id: number;
  date: string;
}
interface Reg {
  event_id: number;
  member_id: string;
  attended: number;
}
interface Member {
  id: string;
  approved_at: string | null;
  requested_at: string;
}

async function load(env: Env, memberId?: string) {
  const nowIso = new Date().toISOString();
  const one = memberId ? " AND r.member_id = ?" : "";
  const regs = env.DB.prepare(
    `SELECT r.event_id, r.member_id, r.attended FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE r.friend_index = 0 AND e.status != 'cancelled' AND e.start_at <= ?${one}`,
  );
  const [events, rows, members] = await env.DB.batch([
    env.DB.prepare("SELECT id, date FROM events WHERE status != 'cancelled' AND start_at <= ? ORDER BY date").bind(
      nowIso,
    ),
    memberId ? regs.bind(nowIso, memberId) : regs.bind(nowIso),
    memberId
      ? env.DB.prepare("SELECT id, approved_at, requested_at FROM members WHERE id = ?").bind(memberId)
      : env.DB.prepare("SELECT id, approved_at, requested_at FROM members WHERE status = 'active'"),
  ]);
  return {
    events: events!.results as unknown as HeldEvent[],
    regs: rows!.results as unknown as Reg[],
    members: members!.results as unknown as Member[],
  };
}

/** One member's numbers from rows already loaded. */
function statFor(
  m: Member,
  events: HeldEvent[],
  dateOf: Map<number, string>,
  regs: Reg[],
  from: string,
  today: string,
): AttendanceStat & { joined: string } {
  const joined = joinedOn(m);
  const since = from > joined ? from : joined;
  const held = events.filter((e) => e.date >= since).length;
  let attended = 0;
  let noShows = 0;
  let last: string | null = null;
  for (const r of regs) {
    const date = dateOf.get(r.event_id);
    if (!date) continue;
    if (r.attended && (!last || date > last)) last = date;
    if (date < from) continue;
    if (r.attended) attended++;
    else noShows++;
  }
  return {
    id: m.id,
    attended,
    held,
    noShows,
    lastDate: last,
    daysSince: last ? daysBetween(last, today) : null,
    joinedDays: daysBetween(joined, today),
    joined,
  };
}

function byMember(regs: Reg[]): Map<string, Reg[]> {
  const out = new Map<string, Reg[]>();
  for (const r of regs) {
    const list = out.get(r.member_id);
    if (list) list.push(r);
    else out.set(r.member_id, [r]);
  }
  return out;
}

/** Every active member's numbers for the window: GET /members/attendance. */
export async function membersAttendance(env: Env, w: AttendanceWindow): Promise<MemberAttendanceResponse> {
  const today = toPacific(new Date()).date;
  const from = windowStart(w, today);
  const { events, regs, members } = await load(env);
  const dateOf = new Map(events.map((e) => [e.id, e.date]));
  const mine = byMember(regs);
  return {
    window: w,
    from: from || null,
    held: events.filter((e) => e.date >= from).length,
    members: members.map((m) => {
      const { joined: _, ...s } = statFor(m, events, dateOf, mine.get(m.id) ?? [], from, today);
      return s;
    }),
    thresholds: { active: ACTIVE_DAYS, quiet: QUIET_DAYS },
  };
}

/** One member's 出勤 card: the window's numbers and how many times they came in each of the last 12 weeks. */
export async function memberAttendance(env: Env, id: string, w: AttendanceWindow): Promise<AttendanceDetail | null> {
  const today = toPacific(new Date()).date;
  const from = windowStart(w, today);
  const { events, regs, members } = await load(env, id);
  const m = members[0];
  if (!m) return null;
  const dateOf = new Map(events.map((e) => [e.id, e.date]));
  const s = statFor(m, events, dateOf, regs, from, today);
  // Week 11 ends today; a week wholly before they joined is null (drawn blank, not as a gap).
  const weeks: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    daysBefore(today, (12 - i) * 7 - 7) < s.joined ? null : 0,
  );
  for (const r of regs) {
    const date = dateOf.get(r.event_id);
    if (!date || !r.attended) continue;
    const back = Math.floor(daysBetween(date, today) / 7);
    const i = 11 - back;
    if (i >= 0 && i < 12) weeks[i] = (weeks[i] ?? 0) + 1;
  }
  const { joined, ...stat } = s;
  return { ...stat, window: w, joined, weeks };
}
