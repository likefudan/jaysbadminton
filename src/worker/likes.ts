import { DEFAULT_LIKE_HOURS, DEFAULT_LIKE_PCT, LIKE_HOURS_MAX, likeCap } from "../shared/rules";
import type { EventLikes, LikeSummary } from "../shared/types";
import { avatarUrl } from "./avatars";
import { getSettings, now } from "./db";
import type { EventRow } from "./events";
import type { Env } from "./env";
import { badRequest } from "./http";
import type { MemberRow } from "./members";

/**
 * 点赞 (Ke Li 2026-11-11): once an event is over, everyone who played may like others who played,
 * one like each, up to a share of the players (15% at first), for some hours (24 at first); both
 * set in 设置 by the Owner and admins. Who played: signed up themselves (not a
 * friend under someone), not marked absent, still an active member. Anonymous: a member only ever
 * sees how many likes they got, never from whom.
 */

/** Who played, for a registration `r` and its member `m`: on the list themselves, not marked absent, an active member. */
const PLAYED = (r: string, m: string) =>
  `${r}.friend_index = 0 AND ${r}.attended = 1 AND ${m}.status = 'active' AND ${m}.deleted_at IS NULL`;

/** A like that counts: both people played (as PLAYED says), the event not cancelled. */
export const COUNTED_LIKE = `JOIN events le ON le.id = l.event_id AND le.status != 'cancelled'
  JOIN registrations lf ON lf.event_id = l.event_id AND lf.member_id = l.from_member
  JOIN members lfm ON lfm.id = l.from_member
  JOIN registrations lt ON lt.event_id = l.event_id AND lt.member_id = l.to_member
  JOIN members ltm ON ltm.id = l.to_member AND ${PLAYED("lf", "lfm")} AND ${PLAYED("lt", "ltm")}`;

const HOUR = 3600_000;

export interface LikeSettings {
  /** Hours after the end that likes may be given. */
  hours: number;
  /** The share of the players each may like, in %. */
  pct: number;
}

/** 点赞 as set in 设置 (24 hours and 15% until changed). */
export async function likeSettings(env: Env): Promise<LikeSettings> {
  const s = await getSettings(env.DB, ["like_hours", "like_pct"]);
  const hours = Number(s.like_hours);
  const pct = Number(s.like_pct);
  return {
    hours: Number.isInteger(hours) && hours >= 1 && hours <= LIKE_HOURS_MAX ? hours : DEFAULT_LIKE_HOURS,
    pct: Number.isInteger(pct) && pct >= 1 && pct <= 100 ? pct : DEFAULT_LIKE_PCT,
  };
}

/** It ended, less than `hours` hours ago, and wasn't cancelled. */
export function likeOpen(e: Pick<EventRow, "status" | "end_at">, hours: number, at = new Date()): boolean {
  if (e.status === "cancelled") return false;
  const end = Date.parse(e.end_at);
  return at.getTime() >= end && at.getTime() <= end + hours * HOUR;
}

/** It is over (likes may have been given), and wasn't cancelled. */
export const likeShown = (e: Pick<EventRow, "status" | "end_at">, at = new Date()) =>
  e.status !== "cancelled" && at.getTime() >= Date.parse(e.end_at);

/**
 * How many likes the member gave and got at each of these events (missing: none either way).
 * Given: every like of theirs, so the cap holds even if someone they liked drops off the list
 * (they can still take that one back). Got: only the ones that count.
 */
export async function likeCounts(
  env: Env,
  memberId: string,
  eventIds?: number[],
): Promise<Map<number, { given: number; received: number }>> {
  const only = (col: string) =>
    eventIds ? ` AND ${col} IN (${eventIds.map((_, i) => `?${i + 2}`).join(",") || "NULL"})` : "";
  const { results } = await env.DB.prepare(
    `SELECT event_id, SUM(given) AS given, SUM(received) AS received FROM (
       SELECT event_id, 1 AS given, 0 AS received FROM likes WHERE from_member = ?1${only("event_id")}
       UNION ALL
       SELECT l.event_id, 0, 1 FROM likes l ${COUNTED_LIKE} WHERE l.to_member = ?1${only("l.event_id")}
     ) GROUP BY event_id`,
  )
    .bind(memberId, ...(eventIds ?? []))
    .all<{ event_id: number; given: number; received: number }>();
  return new Map(results.map((r) => [r.event_id, { given: r.given, received: r.received }]));
}

/** How many likes each player may give at this event. */
async function likeMax(env: Env, eventId: number, pct: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ? AND ${PLAYED("r", "m")}`,
  )
    .bind(eventId)
    .first<{ n: number }>();
  return likeCap(row?.n ?? 0, pct);
}

/** The card's 点赞 line: for a member who played, once it is over; null otherwise. */
export async function likeSummary(
  env: Env,
  e: Pick<EventRow, "id" | "status" | "end_at">,
  played: boolean,
  counts: { given: number; received: number } | undefined,
  cfg: LikeSettings,
): Promise<LikeSummary | null> {
  if (!played || !likeShown(e)) return null;
  const open = likeOpen(e, cfg.hours);
  return {
    open,
    // Only needed while likes can still be given.
    max: open ? await likeMax(env, e.id, cfg.pct) : 0,
    given: counts?.given ?? 0,
    received: counts?.received ?? 0,
  };
}

/** Did the member play at this event: on the list themselves and not marked absent. */
async function played(env: Env, eventId: number, memberId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ? AND r.member_id = ? AND ${PLAYED("r", "m")}`,
  )
    .bind(eventId, memberId)
    .first();
  return row !== null;
}

function mustPlay(ok: boolean) {
  if (!ok) throw badRequest("只有来打球的人可以点赞");
}

/**
 * 点赞 panel: everyone else who played, in list order, and whom the member liked; someone they
 * liked who has since dropped off the list stays at the end, so the like can be taken back.
 */
export async function eventLikes(env: Env, m: MemberRow, e: EventRow): Promise<EventLikes> {
  mustPlay(m.status === "active" && likeShown(e) && (await played(env, e.id, m.id)));
  const cfg = await likeSettings(env);
  const [people, counts, max] = await Promise.all([
    env.DB.prepare(
      `SELECT m.id, m.username, m.avatar, m.google_picture,
         EXISTS (SELECT 1 FROM likes l WHERE l.event_id = ?1 AND l.from_member = ?2 AND l.to_member = m.id) AS liked
       FROM members m LEFT JOIN registrations r ON r.event_id = ?1 AND r.member_id = m.id AND r.friend_index = 0
       WHERE m.id != ?2 AND ((r.id IS NOT NULL AND ${PLAYED("r", "m")})
         OR m.id IN (SELECT to_member FROM likes WHERE event_id = ?1 AND from_member = ?2))
       ORDER BY r.id IS NULL OR NOT (${PLAYED("r", "m")}), r.created_at, r.id`,
    )
      .bind(e.id, m.id)
      .all<{ id: string; username: string; avatar: string | null; google_picture: string | null; liked: number }>(),
    likeCounts(env, m.id, [e.id]),
    likeMax(env, e.id, cfg.pct),
  ]);
  const c = counts.get(e.id);
  return {
    open: likeOpen(e, cfg.hours),
    hours: cfg.hours,
    max,
    given: c?.given ?? 0,
    received: c?.received ?? 0,
    people: people.results.map((p) => ({ id: p.id, name: p.username, avatar: avatarUrl(p), liked: p.liked === 1 })),
  };
}

/**
 * Give or take back a like. At most the event's cap, every like of theirs counted (as likeCounts
 * gives them), in the same statement so two taps at once can't pass it.
 */
export async function setLike(env: Env, m: MemberRow, e: EventRow, to: unknown, on: boolean): Promise<void> {
  if (!likeShown(e)) throw badRequest("活动结束后才能点赞");
  const cfg = await likeSettings(env);
  if (!likeOpen(e, cfg.hours)) throw badRequest(`点赞已截止，活动结束后 ${cfg.hours} 小时内可以点赞`);
  mustPlay(m.status === "active" && (await played(env, e.id, m.id)));
  if (typeof to !== "string" || to === m.id) throw badRequest("只能给一起打球的人点赞");
  // Taking one back works even if they have since dropped off the list.
  if (on && !(await played(env, e.id, to))) throw badRequest("只能给一起打球的人点赞");
  if (!on) {
    await env.DB.prepare("DELETE FROM likes WHERE event_id = ? AND from_member = ? AND to_member = ?")
      .bind(e.id, m.id, to)
      .run();
    return;
  }
  const max = await likeMax(env, e.id, cfg.pct);
  const res = await env.DB.prepare(
    `INSERT INTO likes (event_id, from_member, to_member, created_at)
     SELECT ?1, ?2, ?3, ?4
     WHERE (SELECT COUNT(*) FROM likes WHERE event_id = ?1 AND from_member = ?2) < ?5
     ON CONFLICT DO NOTHING`,
  )
    .bind(e.id, m.id, to, now(), max)
    .run();
  if (res.meta.changes) return;
  const already = await env.DB.prepare("SELECT 1 FROM likes WHERE event_id = ? AND from_member = ? AND to_member = ?")
    .bind(e.id, m.id, to)
    .first();
  if (!already) throw badRequest(`这场最多点 ${max} 个赞`);
}
