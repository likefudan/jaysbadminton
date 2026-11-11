import { LIKE_DAYS, LIKE_MAX } from "../shared/rules";
import type { EventLikes, LikeSummary } from "../shared/types";
import { avatarUrl } from "./avatars";
import { now } from "./db";
import type { EventRow } from "./events";
import type { Env } from "./env";
import { badRequest } from "./http";
import type { MemberRow } from "./members";

/**
 * 点赞 (Ke Li 2026-11-11): once an event is over, everyone who played may like up to LIKE_MAX
 * others who played, one like each, for LIKE_DAYS days. Who played: signed up themselves (not a
 * friend under someone), not marked absent, still an active member. Anonymous: a member only ever
 * sees how many likes they got, never from whom.
 */

/** A like that counts: both people still on the list themselves and not marked absent, the event not cancelled. */
export const COUNTED_LIKE = `JOIN events le ON le.id = l.event_id AND le.status != 'cancelled'
  JOIN registrations lf ON lf.event_id = l.event_id AND lf.member_id = l.from_member AND lf.friend_index = 0 AND lf.attended = 1
  JOIN registrations lt ON lt.event_id = l.event_id AND lt.member_id = l.to_member AND lt.friend_index = 0 AND lt.attended = 1`;

const DAY = 86400_000;

/** It ended, less than LIKE_DAYS days ago, and wasn't cancelled. */
export function likeOpen(e: Pick<EventRow, "status" | "end_at">, at = new Date()): boolean {
  if (e.status === "cancelled") return false;
  const end = Date.parse(e.end_at);
  return at.getTime() >= end && at.getTime() <= end + LIKE_DAYS * DAY;
}

/** It is over (likes may have been given), and wasn't cancelled. */
export const likeShown = (e: Pick<EventRow, "status" | "end_at">, at = new Date()) =>
  e.status !== "cancelled" && at.getTime() >= Date.parse(e.end_at);

/** How many likes the member gave and got at each of these events (missing: none either way). */
export async function likeCounts(
  env: Env,
  memberId: string,
  eventIds?: number[],
): Promise<Map<number, { given: number; received: number }>> {
  const only = eventIds ? ` AND l.event_id IN (${eventIds.map(() => "?").join(",") || "NULL"})` : "";
  const { results } = await env.DB.prepare(
    `SELECT l.event_id, SUM(l.from_member = ?1) AS given, SUM(l.to_member = ?1) AS received
     FROM likes l ${COUNTED_LIKE}
     WHERE (l.from_member = ?1 OR l.to_member = ?1)${only} GROUP BY l.event_id`,
  )
    .bind(memberId, ...(eventIds ?? []))
    .all<{ event_id: number; given: number; received: number }>();
  return new Map(results.map((r) => [r.event_id, { given: r.given, received: r.received }]));
}

/** The card's 点赞 line: for a member who played, once it is over; null otherwise. */
export function likeSummary(
  e: Pick<EventRow, "status" | "end_at">,
  played: boolean,
  counts: { given: number; received: number } | undefined,
): LikeSummary | null {
  if (!played || !likeShown(e)) return null;
  return { open: likeOpen(e), given: counts?.given ?? 0, received: counts?.received ?? 0 };
}

/** Did the member play at this event: on the list themselves and not marked absent. */
async function played(env: Env, eventId: number, memberId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ? AND r.member_id = ? AND r.friend_index = 0 AND r.attended = 1
       AND m.status = 'active' AND m.deleted_at IS NULL`,
  )
    .bind(eventId, memberId)
    .first();
  return row !== null;
}

function mustPlay(ok: boolean) {
  if (!ok) throw badRequest("只有来打球的人可以点赞");
}

/** 点赞 panel: everyone else who played, in list order, and whom the member liked. */
export async function eventLikes(env: Env, m: MemberRow, e: EventRow): Promise<EventLikes> {
  mustPlay(m.status === "active" && likeShown(e) && (await played(env, e.id, m.id)));
  const [people, counts] = await Promise.all([
    env.DB.prepare(
      `SELECT m.id, m.username, m.avatar, m.google_picture,
         EXISTS (SELECT 1 FROM likes l WHERE l.event_id = r.event_id AND l.from_member = ?2 AND l.to_member = m.id) AS liked
       FROM registrations r JOIN members m ON m.id = r.member_id
       WHERE r.event_id = ?1 AND r.friend_index = 0 AND r.attended = 1 AND r.member_id != ?2
         AND m.status = 'active' AND m.deleted_at IS NULL
       ORDER BY r.created_at, r.id`,
    )
      .bind(e.id, m.id)
      .all<{ id: string; username: string; avatar: string | null; google_picture: string | null; liked: number }>(),
    likeCounts(env, m.id, [e.id]),
  ]);
  const c = counts.get(e.id);
  return {
    open: likeOpen(e),
    given: c?.given ?? 0,
    received: c?.received ?? 0,
    people: people.results.map((p) => ({ id: p.id, name: p.username, avatar: avatarUrl(p), liked: p.liked === 1 })),
  };
}

/** Give or take back a like. At most LIKE_MAX per event, counted in the same statement so two taps at once can't pass it. */
export async function setLike(env: Env, m: MemberRow, e: EventRow, to: unknown, on: boolean): Promise<void> {
  if (!likeShown(e)) throw badRequest("活动结束后才能点赞");
  if (!likeOpen(e)) throw badRequest(`点赞已截止，活动结束后 ${LIKE_DAYS} 天内可以点赞`);
  mustPlay(m.status === "active" && (await played(env, e.id, m.id)));
  if (typeof to !== "string" || to === m.id || !(await played(env, e.id, to)))
    throw badRequest("只能给一起打球的人点赞");
  if (!on) {
    await env.DB.prepare("DELETE FROM likes WHERE event_id = ? AND from_member = ? AND to_member = ?")
      .bind(e.id, m.id, to)
      .run();
    return;
  }
  const res = await env.DB.prepare(
    `INSERT INTO likes (event_id, from_member, to_member, created_at)
     SELECT ?1, ?2, ?3, ?4
     WHERE (SELECT COUNT(*) FROM likes l ${COUNTED_LIKE} WHERE l.event_id = ?1 AND l.from_member = ?2) < ${LIKE_MAX}
     ON CONFLICT DO NOTHING`,
  )
    .bind(e.id, m.id, to, now())
    .run();
  if (res.meta.changes) return;
  const already = await env.DB.prepare("SELECT 1 FROM likes WHERE event_id = ? AND from_member = ? AND to_member = ?")
    .bind(e.id, m.id, to)
    .first();
  if (!already) throw badRequest(`每场最多点 ${LIKE_MAX} 个赞`);
}
