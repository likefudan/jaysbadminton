import { eventLength, offsetOf } from "../shared/stay";
import { isTime, toPacific } from "../shared/time";
import {
  BOARD_KEYS,
  type BoardKey,
  DEFAULT_PUBLIC_BOARDS,
  type Leaderboard,
  type MyStats,
  type RankEntry,
  type SpendEntry,
  type YearReview,
} from "../shared/types";
import { MILESTONES, type MilestoneKey, tierOf } from "../shared/milestones";
import { avatarsById, avatarUrl } from "./avatars";
import { getSettings } from "./db";
import { COUNTED_LIKE } from "./likes";
import type { Env } from "./env";
import { badRequest, HttpError } from "./http";

/**
 * Attendance follows the Owner's 到场 marks, so only settled-up events count (finalized or
 * archived); open, closed and cancelled events never do. Years are Pacific calendar years.
 */
const COUNTED = "e.status IN ('finalized', 'settled')";

/** A day as "YYYY-MM-DD" in Pacific time; periods are Pacific calendar years and months. */
const today = () => toPacific(new Date()).date;

interface Row {
  event_id: number;
  date: string;
  start_at: string;
  end_at: string;
  member_id: string;
  username: string;
  friend_index: number;
  attended: number;
  arrive_at: string | null;
  leave_at: string | null;
}

/** Counted registrations from the start of last year on (进步 compares with last year). */
async function rows(env: Env, since: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.event_id, e.date, e.start_at, e.end_at, r.member_id, m.username, r.friend_index, r.attended,
       r.arrive_at, r.leave_at
     FROM registrations r JOIN events e ON e.id = r.event_id JOIN members m ON m.id = r.member_id
     WHERE ${COUNTED} AND m.status = 'active' AND e.date >= ?
     ORDER BY e.start_at`,
  )
    .bind(since)
    .all<Row>();
  return results;
}

/**
 * Top n with ties sharing a rank and the next rank skipping (1, 1, 1, 4); tied people go by
 * name. Everyone tied with the last place shown stays on the board.
 */
export function top(
  counts: Map<string, { name: string; value: number }>,
  n = 10,
  avatars?: Map<string, string | null>,
): RankEntry[] {
  const sorted = [...counts.entries()]
    .filter(([, x]) => x.value > 0)
    .sort(([, a], [, b]) => b.value - a.value || a.name.localeCompare(b.name));
  const out: RankEntry[] = [];
  for (const [i, [id, x]] of sorted.entries()) {
    const prev = out[i - 1];
    const rank = prev && prev.value === x.value ? prev.rank : i + 1;
    if (rank > n) break;
    out.push(
      avatars
        ? { rank, name: x.name, value: x.value, avatar: avatars.get(id) ?? null }
        : { rank, name: x.name, value: x.value },
    );
  }
  return out;
}

type Tally = Map<string, { name: string; value: number }>;
function add(map: Tally, id: string, name: string | undefined, by = 1) {
  if (name === undefined) return; // not an active member
  const cur = map.get(id) ?? { name, value: 0 };
  cur.value += by;
  map.set(id, cur);
}

/**
 * 在场时长 in minutes, read the way 各时段人数 reads a stay: the 到/走 they picked, from the start
 * when 到 is empty or outside the event, to the end when 走 is empty or doesn't fit.
 */
export function stayMinutes(r: Pick<Row, "start_at" | "end_at" | "arrive_at" | "leave_at">): number {
  const start = toPacific(r.start_at).time;
  const len = eventLength(start, toPacific(r.end_at).time);
  let a = r.arrive_at && isTime(r.arrive_at) ? offsetOf(start, r.arrive_at) : 0;
  if (a >= len) a = 0;
  let l = r.leave_at && isTime(r.leave_at) ? offsetOf(start, r.leave_at) : len;
  if (l <= a || l > len) l = len;
  return l - a;
}

/** The same stretch one period back: last month or last year, up to the same day (or its last). */
export function previousPeriod(day: string, unit: "year" | "month"): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const py = unit === "year" ? y - 1 : m === 1 ? y - 1 : y;
  const pm = unit === "year" ? m : m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const to = `${py}-${pad(pm)}-${pad(Math.min(d, last))}`;
  return { from: unit === "year" ? `${py}-01-01` : `${py}-${pad(pm)}-01`, to };
}

interface Extra {
  /** Who signed up among the first EARLY_PLACES of each counted event, by their own sign-up. */
  early: { member_id: string; date: string }[];
  /** 排队: each 球馆账号 added and each court entry put in, by who did it (queue_credits). */
  queue: { member_id: string; date: string }[];
  calories: { member_id: string; date: string; kcal: number }[];
  /** 点赞: each like received, by whom it went to. */
  likes: { member_id: string; date: string }[];
  names: Map<string, string>;
}

/** 早鸟: one of the first five on the list who signed up themselves (not added by an admin), and came. A member someone brought counts as
 * their own sign-up, as everywhere else (Ke Li, #161). */
export const EARLY_PLACES = 5;

/**
 * 早鸟 places: who signed up among the first EARLY_PLACES of each counted event matching `where`,
 * themselves (not added by an admin), and came; `only` keeps one member's.
 */
function earlyQuery(env: Env, where: string, bind: string, only?: string) {
  return env.DB.prepare(
    `SELECT x.member_id, x.date FROM (
       SELECT r.member_id, r.attended, r.added_by_owner, e.date,
         ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY r.created_at, r.id) AS place
       FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE ${COUNTED} AND ${where} AND r.friend_index = 0
     ) x WHERE x.place <= ${EARLY_PLACES} AND x.attended = 1 AND x.added_by_owner = 0${only ? " AND x.member_id = ?" : ""}`,
  ).bind(...(only ? [bind, only] : [bind]));
}

/** The longest run of events in a row (in `events`' order) that `present` has. */
function longestRun(events: Iterable<number>, present: (id: number) => boolean): number {
  let run = 0;
  let best = 0;
  for (const id of events) {
    run = present(id) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Minutes as hours to one decimal. */
const toHours = (min: number) => Math.round(min / 6) / 10;

async function extra(env: Env, since: string): Promise<Extra> {
  const [early, queue, calories, likes, members] = await env.DB.batch([
    earlyQuery(env, "e.date >= ?", since),
    env.DB.prepare(
      `SELECT q.member_id, e.date FROM queue_credits q JOIN events e ON e.id = q.event_id
       WHERE ${COUNTED} AND e.date >= ?`,
    ).bind(since),
    // 能量: the same total as 我的卡路里 shows them, for the members who chose to be on it.
    env.DB.prepare(
      `SELECT c.member_id, e.date, c.kcal
       FROM calories c JOIN events e ON e.id = c.event_id JOIN members m ON m.id = c.member_id
       JOIN registrations r ON r.event_id = c.event_id AND r.member_id = c.member_id AND r.friend_index = 0
       WHERE e.status != 'cancelled' AND m.calorie_board = 1 AND r.attended = 1 AND e.date >= ?`,
    ).bind(since),
    // 点赞: likes count as soon as they're given, before the event is settled (the board is about
    // the people, not the money), unless the event is cancelled or either one marked absent.
    env.DB.prepare(`SELECT l.to_member AS member_id, le.date FROM likes l ${COUNTED_LIKE} WHERE le.date >= ?`).bind(
      since,
    ),
    env.DB.prepare("SELECT id, username FROM members WHERE status = 'active'"),
  ]);
  return {
    early: early!.results as Extra["early"],
    queue: queue!.results as Extra["queue"],
    calories: calories!.results as Extra["calories"],
    likes: likes!.results as Extra["likes"],
    names: new Map((members!.results as { id: string; username: string }[]).map((m) => [m.id, m.username])),
  };
}

/** Every board for one period: the dates from `from` to `to`, and the stretch before it for 进步. */
function boards(
  all: Row[],
  x: Extra,
  from: string,
  to: string,
  before: { from: string; to: string },
  avatars?: Map<string, string | null>,
): Record<BoardKey, RankEntry[]> {
  const inside = (d: string) => d >= from && d <= to;
  const tallies = Object.fromEntries(BOARD_KEYS.map((k) => [k, new Map()])) as Record<BoardKey, Tally>;
  const earlier: Tally = new Map();
  for (const r of all) {
    if (!r.attended) continue;
    if (r.friend_index > 0) {
      if (inside(r.date)) add(tallies.friends, r.member_id, r.username);
      continue;
    }
    if (inside(r.date)) {
      add(tallies.attendance, r.member_id, r.username);
      add(tallies.hours, r.member_id, r.username, stayMinutes(r));
    } else if (r.date >= before.from && r.date <= before.to) add(earlier, r.member_id, r.username);
  }
  // Fewer or the same come out at 0 or below, which top() leaves off the board.
  for (const [id, now] of tallies.attendance)
    tallies.progress.set(id, { name: now.name, value: now.value - (earlier.get(id)?.value ?? 0) });

  // 最长连续: the longest run of counted events in a row in this period.
  const events = [...new Set(all.filter((r) => inside(r.date)).map((r) => r.event_id))];
  const present = new Set(
    all.filter((r) => r.friend_index === 0 && r.attended && inside(r.date)).map((r) => `${r.event_id}:${r.member_id}`),
  );
  for (const [id, { name }] of tallies.attendance)
    tallies.streak.set(id, { name, value: longestRun(events, (ev) => present.has(`${ev}:${id}`)) });
  for (const e of x.early) if (inside(e.date)) add(tallies.early, e.member_id, x.names.get(e.member_id));
  for (const q of x.queue) if (inside(q.date)) add(tallies.queue, q.member_id, x.names.get(q.member_id));
  for (const c of x.calories) if (inside(c.date)) add(tallies.calories, c.member_id, x.names.get(c.member_id), c.kcal);
  for (const l of x.likes) if (inside(l.date)) add(tallies.likes, l.member_id, x.names.get(l.member_id));

  // Hours to one decimal, from minutes, before ranking: the same hours shown share a rank.
  for (const h of tallies.hours.values()) h.value = toHours(h.value);
  return Object.fromEntries(BOARD_KEYS.map((k) => [k, top(tallies[k], 10, avatars)])) as Record<BoardKey, RankEntry[]>;
}

/**
 * 排行榜: every board for this year and this month. Members only, never money. Each entry carries
 * the member's 头像 unless `avatars` is false (visitors who aren't signed in).
 */
export async function leaderboard(env: Env, opts: { avatars?: boolean } = {}): Promise<Leaderboard> {
  const day = today();
  const year = day.slice(0, 4);
  const month = day.slice(0, 7);
  // 进步 compares attendance with last year; the other boards only need this year.
  const [all, x, faces] = await Promise.all([
    rows(env, `${Number(year) - 1}-01-01`),
    extra(env, `${year}-01-01`),
    opts.avatars === false ? undefined : avatarsById(env),
  ]);
  const yearly = boards(all, x, `${year}-01-01`, day, previousPeriod(day, "year"), faces);
  const monthly = boards(all, x, `${month}-01`, day, previousPeriod(day, "month"), faces);
  return { year: Number(year), month: Number(day.slice(5, 7)), boards: [...BOARD_KEYS], ...yearly, monthly };
}

/** Only the boards in `keys`; the others come back empty. */
export function onlyBoards(b: Leaderboard, keys: BoardKey[]): Leaderboard {
  const empty = (k: BoardKey) => !keys.includes(k);
  const out = { ...b, boards: [...keys], monthly: { ...b.monthly } };
  for (const k of BOARD_KEYS)
    if (empty(k)) {
      out[k] = [];
      out.monthly[k] = [];
    }
  return out;
}

/** Which boards the home page shows, and whether visitors who aren't signed in see them. */
export async function boardSettings(env: Env): Promise<{ public: BoardKey[]; order: BoardKey[]; anon: boolean }> {
  const s = await getSettings(env.DB, [
    "leaderboard_boards",
    "show_leaderboard",
    "leaderboard_anon",
    "leaderboard_order",
  ]);
  const saved = (s.leaderboard_order ?? "").split(",");
  const order = [...new Set([...saved, ...BOARD_KEYS])].filter((k): k is BoardKey =>
    BOARD_KEYS.includes(k as BoardKey),
  );
  // Before the per-board switches there was one: off meant no board, on the four boards then.
  const picked =
    s.leaderboard_boards !== undefined
      ? s.leaderboard_boards.split(",")
      : s.show_leaderboard === "0"
        ? []
        : DEFAULT_PUBLIC_BOARDS;
  return { public: order.filter((k) => picked.includes(k)), order, anon: s.leaderboard_anon === "1" };
}

/**
 * 个人统计: only on the member's own page. Spending is what they were billed (incl. friends) plus
 * what they noted they paid themselves (自付费用, e.g. a drop-in fee at the door).
 */
export async function myStats(env: Env, memberId: string): Promise<MyStats> {
  const today = toPacific(new Date()).date;
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const sameDayLastYear = `${lastYear}${today.slice(4)}`;

  type Row = { id: number; date: string; title: string; location: string };
  const [visitRows, billRows, extraRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.id, e.date, e.title, e.location FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE ${COUNTED} AND r.member_id = ? AND r.friend_index = 0 AND r.attended = 1`,
    ).bind(memberId),
    env.DB.prepare(
      `SELECT e.id, e.date, e.title, e.location, p.amount_due_cents FROM payments p JOIN events e ON e.id = p.event_id
       WHERE ${COUNTED} AND p.member_id = ?`,
    ).bind(memberId),
    env.DB.prepare("SELECT event_id, cents FROM extra_spend WHERE member_id = ?").bind(memberId),
  ]);
  const visits = visitRows!.results as Row[];
  const bills = billRows!.results as (Row & { amount_due_cents: number })[];
  const extra = new Map(
    (extraRows!.results as { event_id: number; cents: number }[]).map((x) => [x.event_id, x.cents]),
  );

  // One entry per counted event they came to or were billed for, oldest first: the page picks a range.
  const came = new Set(visits.map((v) => v.id));
  const history: SpendEntry[] = bills.map((b) => ({
    id: b.id,
    date: b.date,
    title: b.title,
    location: b.location,
    cents: b.amount_due_cents,
    extraCents: extra.get(b.id) ?? 0,
    attended: came.has(b.id),
  }));
  const billed = new Set(bills.map((b) => b.id));
  for (const v of visits)
    if (!billed.has(v.id))
      history.push({
        id: v.id,
        date: v.date,
        title: v.title,
        location: v.location,
        cents: 0,
        extraCents: extra.get(v.id) ?? 0,
        attended: true,
      });
  history.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const inYear = (d: string, y: string, upTo?: string) => d.startsWith(y) && (!upTo || d <= upTo);
  const spent = (y: string, upTo?: string) =>
    history.filter((h) => inYear(h.date, y, upTo)).reduce((t, h) => t + h.cents + h.extraCents, 0);
  const yearCount = visits.filter((v) => inYear(v.date, year)).length;
  const yearSpend = spent(year);
  return {
    year: Number(year),
    yearCount,
    totalCount: visits.length,
    yearSpendCents: yearSpend,
    avgSpendCents: yearCount ? Math.round(yearSpend / yearCount) : 0,
    lastYearCount: visits.filter((v) => inYear(v.date, lastYear, sameDayLastYear)).length,
    lastYearSpendCents: spent(lastYear, sameDayLastYear),
    today,
    history,
  };
}

/** Most one can note for one event: a typo guard, far above any court fee. */
export const EXTRA_MAX_CENTS = 100_000;

/**
 * 自付费用 (Ke Li 2026-11-14, option B): sets, or with 0 clears, what the member paid themselves for
 * an event. Only for events in their own 我的花费: counted ones they came to or were billed for.
 */
export async function setExtraSpend(env: Env, memberId: string, eventId: number, cents: number): Promise<void> {
  if (!Number.isInteger(cents) || cents < 0 || cents > EXTRA_MAX_CENTS)
    throw badRequest(`金额要在 $0 到 $${EXTRA_MAX_CENTS / 100} 之间`);
  const mine = await env.DB.prepare(
    `SELECT 1 FROM events e WHERE e.id = ?1 AND ${COUNTED} AND (
       EXISTS (SELECT 1 FROM registrations r
               WHERE r.event_id = e.id AND r.member_id = ?2 AND r.friend_index = 0 AND r.attended = 1)
       OR EXISTS (SELECT 1 FROM payments p WHERE p.event_id = e.id AND p.member_id = ?2))`,
  )
    .bind(eventId, memberId)
    .first();
  if (!mine) throw new HttpError(404, "not_in_history", "这场活动不在你的花费记录里");
  if (cents === 0)
    await env.DB.prepare("DELETE FROM extra_spend WHERE member_id = ? AND event_id = ?").bind(memberId, eventId).run();
  else
    await env.DB.prepare(
      `INSERT INTO extra_spend (member_id, event_id, cents, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (member_id, event_id) DO UPDATE SET cents = excluded.cents, updated_at = excluded.updated_at`,
    )
      .bind(memberId, eventId, cents, new Date().toISOString())
      .run();
}

/**
 * 年度回顾 (Ke Li 2026-11-10, option P): one year of their own numbers, read the same way the
 * boards read them, the badges from all-time totals, and the members they played with most.
 */
export async function yearReview(env: Env, memberId: string, asked?: number): Promise<YearReview> {
  const thisYear = Number(today().slice(0, 4));
  const [mine, friends, early, queue, kcal, counted] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.id, e.date, e.start_at, e.end_at, e.location, r.arrive_at, r.leave_at
       FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE ${COUNTED} AND r.member_id = ? AND r.friend_index = 0 AND r.attended = 1`,
    ).bind(memberId),
    env.DB.prepare(
      `SELECT e.date FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE ${COUNTED} AND r.member_id = ? AND r.friend_index > 0 AND r.attended = 1`,
    ).bind(memberId),
    // Only the events they were on: the places are counted within each.
    earlyQuery(
      env,
      "e.id IN (SELECT event_id FROM registrations WHERE member_id = ? AND friend_index = 0)",
      memberId,
      memberId,
    ),
    env.DB.prepare(
      `SELECT e.date FROM queue_credits q JOIN events e ON e.id = q.event_id WHERE ${COUNTED} AND q.member_id = ?`,
    ).bind(memberId),
    // The same as 我的卡路里: every event read that isn't cancelled, unless marked absent.
    env.DB.prepare(
      `SELECT e.date, c.kcal FROM calories c JOIN events e ON e.id = c.event_id
       JOIN registrations r ON r.event_id = c.event_id AND r.member_id = c.member_id AND r.friend_index = 0
       WHERE e.status != 'cancelled' AND r.attended = 1 AND c.member_id = ?`,
    ).bind(memberId),
    env.DB.prepare(`SELECT e.id FROM events e WHERE ${COUNTED} ORDER BY e.start_at`),
  ]);
  type Mine = Pick<Row, "date" | "start_at" | "end_at" | "arrive_at" | "leave_at"> & { id: number; location: string };
  const came = mine!.results as Mine[];
  const dates = (r: D1Result) => (r.results as { date: string }[]).map((x) => x.date);
  const kcalRows = kcal!.results as { date: string; kcal: number }[];
  // Any year with something on the card: came, brought friends, helped with the queue, read calories.
  const any = [came, friends!.results, early!.results, queue!.results, kcalRows].flatMap((rows) =>
    (rows as { date: string }[]).map((r) => Number(r.date.slice(0, 4))),
  );
  const years = [...new Set([thisYear, ...any])].sort((a, b) => b - a);
  const year = asked && years.includes(asked) ? asked : thisYear;
  const inYear = (d: string) => d.startsWith(`${year}-`);
  const yearRows = came.filter((r) => inYear(r.date));

  const venues = new Map<string, number>();
  for (const r of yearRows) venues.set(r.location, (venues.get(r.location) ?? 0) + 1);
  const venue = [...venues].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  const { results: buddies } = await env.DB.prepare(
    `SELECT m.username AS name, COUNT(*) AS count, m.avatar, m.google_picture
     FROM registrations r JOIN events e ON e.id = r.event_id
     JOIN registrations o ON o.event_id = r.event_id AND o.friend_index = 0 AND o.attended = 1 AND o.member_id != r.member_id
     JOIN members m ON m.id = o.member_id
     WHERE ${COUNTED} AND r.member_id = ? AND r.friend_index = 0 AND r.attended = 1 AND e.date LIKE ? AND m.status = 'active'
     GROUP BY o.member_id ORDER BY count DESC, m.username LIMIT 3`,
  )
    .bind(memberId, `${year}-%`)
    .all<{ name: string; count: number; avatar: string | null; google_picture: string | null }>();

  const hours = (rows: Mine[]) => toHours(rows.reduce((t, r) => t + stayMinutes(r), 0));
  const yearKcal = kcalRows.filter((r) => inYear(r.date));

  // 最长连续 over every counted event ever held, for the badge.
  const present = new Set(came.map((r) => r.id));
  const best = longestRun(
    (counted!.results as { id: number }[]).map((e) => e.id),
    (id) => present.has(id),
  );
  const totals: Record<MilestoneKey, number> = {
    attendance: came.length,
    hours: hours(came),
    streak: best,
    early: early!.results.length,
    friends: friends!.results.length,
    queue: queue!.results.length,
  };
  return {
    year,
    years,
    count: yearRows.length,
    hours: hours(yearRows),
    kcal: yearKcal.length ? yearKcal.reduce((t, r) => t + r.kcal, 0) : null,
    early: dates(early!).filter(inYear).length,
    friends: dates(friends!).filter(inYear).length,
    queue: dates(queue!).filter(inYear).length,
    venue: venue ? { name: venue[0], count: venue[1] } : null,
    buddies: buddies.map((b) => ({ name: b.name, count: b.count, avatar: avatarUrl(b) })),
    milestones: MILESTONES.map(({ key, tiers }) => ({ key, value: totals[key], tier: tierOf(tiers, totals[key]) })),
  };
}
