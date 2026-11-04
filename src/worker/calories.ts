import { SHORTCUT_INSTALL_URL, SHORTCUT_VERSION } from "../shared/calories";
import type { CalorieStart, MyCalories } from "../shared/types";
import { toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { EventRow } from "./events";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { randomToken, sha256 } from "./lib/crypto";
import type { MemberRow } from "./members";

/** 读取 is offered from the start of the event for 30 days (Ke Li), unless 设置 says otherwise. */
export const DEFAULT_READ_DAYS = 30;
const UPLOAD_MINUTES = 15;
/** More than anyone burns in an evening of badminton: anything above is a wrong reading. */
export const KCAL_MAX = 3000;

/** 读取卡路里: how many days from the start, as set in 设置. */
export async function calorieReadDays(env: Env): Promise<number> {
  const n = Number((await getSettings(env.DB, ["calorie_read_days"])).calorie_read_days);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_READ_DAYS;
}

/** The Shortcut to install and its version, as set in 设置 (the built-in ones until then). */
export async function shortcutSetting(env: Env): Promise<{ url: string; version: number }> {
  const s = await getSettings(env.DB, ["calorie_shortcut_url", "calorie_shortcut_version"]);
  const v = Number(s.calorie_shortcut_version);
  return {
    url: s.calorie_shortcut_url || SHORTCUT_INSTALL_URL,
    version: Number.isInteger(v) && v >= 1 ? v : SHORTCUT_VERSION,
  };
}

/** The member may read their 卡路里 for this event now: they played (signed up themselves) and it has started, up to `days` days. */
export function canRead(
  e: Pick<EventRow, "status" | "start_at">,
  selfOn: boolean,
  days: number,
  at = new Date(),
): boolean {
  if (!selfOn || e.status === "cancelled") return false;
  const start = Date.parse(e.start_at);
  return at.getTime() >= start && at.getTime() <= start + days * 86400_000;
}

/** Their own number for each of these events (missing: not read yet). */
export async function caloriesOf(env: Env, memberId: string, eventIds?: number[]): Promise<Map<number, number>> {
  const only = eventIds ? ` AND event_id IN (${eventIds.map(() => "?").join(",") || "NULL"})` : "";
  const { results } = await env.DB.prepare(`SELECT event_id, kcal FROM calories WHERE member_id = ?${only}`)
    .bind(memberId, ...(eventIds ?? []))
    .all<{ event_id: number; kcal: number }>();
  return new Map(results.map((r) => [r.event_id, r.kcal]));
}

/**
 * 读取: a one-time code for the Shortcut to post this event's number with, and what it needs to
 * look up 「健康」: the event's start and end. The Shortcut itself carries no account.
 */
export async function startUpload(env: Env, m: MemberRow, e: EventRow, origin: string): Promise<CalorieStart> {
  const selfOn = await env.DB.prepare(
    "SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index = 0",
  )
    .bind(e.id, m.id)
    .first();
  const days = await calorieReadDays(env);
  if (!canRead(e, !!selfOn, days)) throw badRequest(`活动开始后 ${days} 天内，报名了这场的人才能读取卡路里`);
  const code = randomToken();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM calorie_uploads WHERE expires_at < ?").bind(ts),
    env.DB.prepare("INSERT INTO calorie_uploads (code_hash, event_id, member_id, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256(code),
      e.id,
      m.id,
      new Date(Date.now() + UPLOAD_MINUTES * 60_000).toISOString(),
    ),
  ]);
  return {
    ...timeWindow(e),
    upload: `${origin}/api/calories/${code}`,
  };
}

/** Warm-up counts too: the Shortcut reads from this long before the start (Ke Li). */
export const WARMUP_MINUTES = 10;

/**
 * The event's time for the Shortcut, as Pacific "YYYY-MM-DD HH:mm". 「健康」 only filters by whole
 * days, so the Shortcut fetches the days around them and keeps the samples that start in between.
 */
export function timeWindow(e: Pick<EventRow, "start_at" | "end_at">): Pick<CalorieStart, "start" | "end"> {
  const at = (p: { date: string; time: string }) => `${p.date} ${p.time}`;
  return {
    start: at(toPacific(new Date(Date.parse(e.start_at) - WARMUP_MINUTES * 60_000))),
    end: at(toPacific(e.end_at)),
  };
}

/** They last uploaded with an older Shortcut than the install link gives (never uploaded: not asked). */
export function shortcutOutdated(v: number | null, current: number): boolean {
  return v !== null && v < current;
}

/** The Shortcut posting the number: the code is used up whether or not the number is accepted. */
export async function saveUpload(env: Env, code: string, raw: unknown, version?: unknown): Promise<number> {
  const row = await env.DB.prepare(
    "DELETE FROM calorie_uploads WHERE code_hash = ? AND expires_at >= ? RETURNING event_id, member_id",
  )
    .bind(await sha256(code), now())
    .first<{ event_id: number; member_id: string }>();
  if (!row) throw new HttpError(403, "invalid_upload", "这个读取链接已经用过或者过期了，请回到活动页再点一次「读取」");
  const n = typeof raw === "string" ? Number(raw.replace(/[^\d.]/g, "")) : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > KCAL_MAX) throw badRequest("卡路里数字不对");
  const kcal = Math.round(n);
  const v = Number(version);
  await env.DB.prepare("UPDATE members SET calorie_shortcut_v = ? WHERE id = ?")
    .bind(Number.isInteger(v) && v > 0 ? v : 1, row.member_id)
    .run();
  // 0: nothing in 「健康」 for that time (no Apple Watch worn); keep 读取 on the card rather than a 0.
  if (kcal === 0) return 0;
  await env.DB.prepare(
    `INSERT INTO calories (event_id, member_id, kcal, recorded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (event_id, member_id) DO UPDATE SET kcal = excluded.kcal, recorded_at = excluded.recorded_at`,
  )
    .bind(row.event_id, row.member_id, kcal, now())
    .run();
  return kcal;
}

/** 我的卡路里 on 个人信息: this year's total and every event read, newest first. */
export async function myCalories(env: Env, m: MemberRow): Promise<MyCalories> {
  const year = toPacific(new Date()).date.slice(0, 4);
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.code, e.date, e.title, e.location, c.kcal FROM calories c JOIN events e ON e.id = c.event_id
     WHERE c.member_id = ? AND e.status != 'cancelled' ORDER BY e.start_at DESC`,
  )
    .bind(m.id)
    .all<{ id: number; code: string; date: string; title: string; location: string; kcal: number }>();
  const thisYear = results.filter((r) => r.date.startsWith(year));
  const shortcut = await shortcutSetting(env);
  return {
    year: Number(year),
    yearKcal: thisYear.reduce((t, r) => t + r.kcal, 0),
    yearCount: thisYear.length,
    board: m.calorie_board === 1,
    events: results,
    shortcut: { url: shortcut.url, outdated: shortcutOutdated(m.calorie_shortcut_v, shortcut.version) },
  };
}

/**
 * Deletes their 卡路里 for one event, or all of it when none is given. The event is its id; a page
 * from before ids were sent names it by code, which repeats from year to year (1006 in 2026 and in
 * 2027), so that means the latest event with the code that they have a number for.
 */
export async function deleteCalories(env: Env, m: MemberRow, event?: { id: number } | { code: string }): Promise<void> {
  if (event === undefined) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM calories WHERE member_id = ?").bind(m.id),
      env.DB.prepare("DELETE FROM calorie_uploads WHERE member_id = ?").bind(m.id),
    ]);
    return;
  }
  if ("id" in event) {
    await env.DB.prepare("DELETE FROM calories WHERE member_id = ? AND event_id = ?").bind(m.id, event.id).run();
    return;
  }
  await env.DB.prepare(
    `DELETE FROM calories WHERE member_id = ?1 AND event_id = (SELECT e.id FROM events e JOIN calories c
       ON c.event_id = e.id AND c.member_id = ?1 WHERE e.code = ?2 ORDER BY e.start_at DESC LIMIT 1)`,
  )
    .bind(m.id, event.code)
    .run();
}

export async function setCalorieBoard(env: Env, m: MemberRow, on: boolean): Promise<void> {
  await env.DB.prepare("UPDATE members SET calorie_board = ? WHERE id = ?")
    .bind(on ? 1 : 0, m.id)
    .run();
}
