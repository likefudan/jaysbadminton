import { toPacific } from "../shared/time";
import type { Leaderboard, MyStats, RankEntry, SpendEntry } from "../shared/types";
import type { Env } from "./env";

/**
 * Attendance follows the Owner's 到场 marks, so only settled-up events count (finalized or
 * archived); open, closed and cancelled events never do. Years are Pacific calendar years.
 */
const COUNTED = "e.status IN ('finalized', 'settled')";

interface Row {
  event_id: number;
  date: string;
  member_id: string;
  username: string;
  friend_index: number;
  attended: number;
}

async function rows(env: Env): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.event_id, e.date, r.member_id, m.username, r.friend_index, r.attended
     FROM registrations r JOIN events e ON e.id = r.event_id JOIN members m ON m.id = r.member_id
     WHERE ${COUNTED} AND m.status = 'active'
     ORDER BY e.start_at`,
  ).all<Row>();
  return results;
}

const thisYear = () => toPacific(new Date()).date.slice(0, 4);

function top(counts: Map<string, { name: string; value: number }>, n = 10): RankEntry[] {
  return [...counts.values()]
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, n);
}

/** 公开排行榜: members only, never money. */
export async function leaderboard(env: Env): Promise<Leaderboard> {
  const year = thisYear();
  const all = await rows(env);
  const attendance = new Map<string, { name: string; value: number }>();
  const friends = new Map<string, { name: string; value: number }>();
  for (const r of all) {
    if (r.date.slice(0, 4) !== year || !r.attended) continue;
    const map = r.friend_index === 0 ? attendance : friends;
    const cur = map.get(r.member_id) ?? { name: r.username, value: 0 };
    cur.value++;
    map.set(r.member_id, cur);
  }

  // Longest run of consecutive counted events attended, over all events ever held.
  const events = [...new Set(all.map((r) => r.event_id))];
  const present = new Set(
    all.filter((r) => r.friend_index === 0 && r.attended).map((r) => `${r.event_id}:${r.member_id}`),
  );
  const names = new Map(all.map((r) => [r.member_id, r.username]));
  const streak = new Map<string, { name: string; value: number }>();
  for (const [id, name] of names) {
    let run = 0;
    let best = 0;
    for (const ev of events) {
      run = present.has(`${ev}:${id}`) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    streak.set(id, { name, value: best });
  }
  return { year: Number(year), attendance: top(attendance), streak: top(streak), friends: top(friends) };
}

/** 个人统计: only on the member's own page. Spending is what they were billed (incl. friends). */
export async function myStats(env: Env, memberId: string): Promise<MyStats> {
  const today = toPacific(new Date()).date;
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const sameDayLastYear = `${lastYear}${today.slice(4)}`;

  const { results: visits } = await env.DB.prepare(
    `SELECT e.id, e.date FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE ${COUNTED} AND r.member_id = ? AND r.friend_index = 0 AND r.attended = 1`,
  )
    .bind(memberId)
    .all<{ id: number; date: string }>();
  const { results: bills } = await env.DB.prepare(
    `SELECT e.id, e.date, e.title, e.location, p.amount_due_cents FROM payments p JOIN events e ON e.id = p.event_id
     WHERE ${COUNTED} AND p.member_id = ?`,
  )
    .bind(memberId)
    .all<{ id: number; date: string; title: string; location: string; amount_due_cents: number }>();

  // One entry per counted event they came to or were billed for, oldest first: the page picks a range.
  const came = new Set(visits.map((v) => v.id));
  const history: SpendEntry[] = bills.map((b) => ({
    date: b.date,
    title: b.title,
    location: b.location,
    cents: b.amount_due_cents,
    attended: came.has(b.id),
  }));
  const billed = new Set(bills.map((b) => b.id));
  for (const v of visits)
    if (!billed.has(v.id)) history.push({ date: v.date, title: "", location: "", cents: 0, attended: true });
  history.sort((a, b) => a.date.localeCompare(b.date));

  const inYear = (d: string, y: string, upTo?: string) => d.startsWith(y) && (!upTo || d <= upTo);
  const yearCount = visits.filter((v) => inYear(v.date, year)).length;
  const yearSpend = bills.filter((b) => inYear(b.date, year)).reduce((t, b) => t + b.amount_due_cents, 0);
  return {
    year: Number(year),
    yearCount,
    totalCount: visits.length,
    yearSpendCents: yearSpend,
    avgSpendCents: yearCount ? Math.round(yearSpend / yearCount) : 0,
    lastYearCount: visits.filter((v) => inYear(v.date, lastYear, sameDayLastYear)).length,
    lastYearSpendCents: bills
      .filter((b) => inYear(b.date, lastYear, sameDayLastYear))
      .reduce((t, b) => t + b.amount_due_cents, 0),
    today,
    history,
  };
}
