import { checkGames, GUEST_NAME_MAX, SCORE_DAYS } from "../shared/rules";
import type { Match, MatchPlayer, MatchStatus, ScorePeople, ScoreSummary } from "../shared/types";
import { avatarUrl } from "./avatars";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest } from "./http";
import type { MemberRow } from "./members";
import { pushScore } from "./push";

/**
 * 比分 (Ke Li 2026-11-21): someone who played records a singles or doubles match at the event.
 * Players are others who played there, or 路人 (non-members, name optional). The other side needs at
 * least one member, and every member on court but the recorder must confirm (her pick); one
 * 「比分不对」 voids it, and one left unconfirmed for SCORE_DAYS lapses. Confirmed matches show to
 * everyone on the event's list; the others only to the people on court.
 */

const DAY = 86_400_000;

/** 比分 is off until the Owner or an admin turns it on in 设置 › 高级设置 (Ke Li 2026-11-21). */
export async function scoresEnabled(env: Env): Promise<boolean> {
  return (await getSettings(env.DB, ["scores_on"])).scores_on === "1";
}

async function mustBeOn(env: Env) {
  if (!(await scoresEnabled(env))) throw badRequest("比分记录没有打开");
}

/** Who played, for a registration `r` and its member `m` (as 点赞 has it). */
const PLAYED = (r: string, m: string) =>
  `${r}.friend_index = 0 AND ${r}.attended = 1 AND ${m}.status = 'active' AND ${m}.deleted_at IS NULL`;

/** Matches may be recorded: it started, not more than SCORE_DAYS ago it ended, not cancelled. */
export function scoreOpen(e: Pick<EventRow, "status" | "start_at" | "end_at">, at = new Date()): boolean {
  if (e.status === "cancelled") return false;
  const t = at.getTime();
  return t >= Date.parse(e.start_at) && t <= Date.parse(e.end_at) + SCORE_DAYS * DAY;
}

/** Where a match stands, from the members' answers and when it was recorded. */
export function matchStatus(answers: ("ok" | "no" | null)[], createdAt: string, at = new Date()): MatchStatus {
  if (answers.includes("no")) return "rejected";
  if (answers.every((a) => a === "ok")) return "confirmed";
  return at.getTime() > Date.parse(createdAt) + SCORE_DAYS * DAY ? "expired" : "pending";
}

async function played(env: Env, eventId: number, memberId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ? AND r.member_id = ? AND ${PLAYED("r", "m")}`,
  )
    .bind(eventId, memberId)
    .first();
  return row !== null;
}

interface PlayerRow {
  match_id: number;
  side: number;
  slot: number;
  member_id: string | null;
  guest_name: string | null;
  answer: "ok" | "no" | null;
  username: string | null;
}

/** The event's matches that `viewer` may see, oldest first. */
export async function eventMatches(env: Env, eventId: number, viewer: string): Promise<Match[]> {
  const [matches, players] = await env.DB.batch([
    env.DB.prepare(
      `SELECT x.id, x.recorded_by, x.doubles, x.games, x.created_at, m.username AS recorder
       FROM matches x JOIN members m ON m.id = x.recorded_by WHERE x.event_id = ? ORDER BY x.created_at, x.id`,
    ).bind(eventId),
    env.DB.prepare(
      `SELECT p.match_id, p.side, p.slot, p.member_id, p.guest_name, p.answer, m.username
       FROM match_players p JOIN matches x ON x.id = p.match_id LEFT JOIN members m ON m.id = p.member_id
       WHERE x.event_id = ? ORDER BY p.match_id, p.side, p.slot`,
    ).bind(eventId),
  ]);
  const bySide = new Map<number, PlayerRow[]>();
  for (const p of players!.results as unknown as PlayerRow[]) {
    const list = bySide.get(p.match_id) ?? [];
    list.push(p);
    bySide.set(p.match_id, list);
  }
  const at = new Date();
  const out: Match[] = [];
  for (const x of matches!.results as unknown as {
    id: number;
    recorded_by: string;
    doubles: number;
    games: string;
    created_at: string;
    recorder: string;
  }[]) {
    const rows = bySide.get(x.id) ?? [];
    const members = rows.filter((p) => p.member_id !== null);
    const status = matchStatus(
      members.map((p) => p.answer),
      x.created_at,
      at,
    );
    const onCourt = members.some((p) => p.member_id === viewer);
    if (status !== "confirmed" && !onCourt) continue;
    const toPlayer = (p: PlayerRow): MatchPlayer => ({
      id: p.member_id,
      name: p.member_id ? (p.username ?? "") : (p.guest_name ?? ""),
      answer: p.member_id ? p.answer : null,
      me: p.member_id === viewer,
    });
    out.push({
      id: x.id,
      doubles: x.doubles === 1,
      games: JSON.parse(x.games),
      sides: [rows.filter((p) => p.side === 0).map(toPlayer), rows.filter((p) => p.side === 1).map(toPlayer)],
      status,
      recorder: x.recorder,
      mine: x.recorded_by === viewer,
      toAnswer: status === "pending" && members.some((p) => p.member_id === viewer && p.answer === null),
      createdAt: x.created_at,
    });
  }
  return out;
}

/** The card's 比分: for members on the list themselves, once it started; null when there's nothing to show. */
export async function scoreSummary(
  env: Env,
  e: Pick<EventRow, "id" | "status" | "start_at" | "end_at">,
  m: MemberRow,
  selfOn: boolean,
  playedIt: boolean,
): Promise<ScoreSummary | null> {
  if (!selfOn || e.status === "cancelled" || Date.now() < Date.parse(e.start_at)) return null;
  if (!(await scoresEnabled(env))) return null;
  const open = m.status === "active" && playedIt && scoreOpen(e);
  const matches = await eventMatches(env, e.id, m.id);
  if (!open && matches.length === 0) return null;
  return { open, matches };
}

/** Who can be picked for a match: everyone else who played, in list order. */
export async function scorePeople(env: Env, m: MemberRow, e: EventRow): Promise<ScorePeople> {
  await mustRecord(env, m, e);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.username, m.avatar, m.google_picture FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ?1 AND m.id != ?2 AND ${PLAYED("r", "m")} ORDER BY r.created_at, r.id`,
  )
    .bind(e.id, m.id)
    .all<{ id: string; username: string; avatar: string | null; google_picture: string | null }>();
  return { people: results.map((p) => ({ id: p.id, name: p.username, avatar: avatarUrl(p) })) };
}

async function mustRecord(env: Env, m: MemberRow, e: EventRow) {
  await mustBeOn(env);
  if (e.status === "cancelled") throw badRequest("活动已取消");
  if (m.status !== "active" || !(await played(env, e.id, m.id))) throw badRequest("只有来打球的人可以记录比分");
  if (!scoreOpen(e)) throw badRequest(`活动开始后到结束 ${SCORE_DAYS} 天内可以记录比分`);
}

type Pick1 = { id: string; guest?: undefined } | { id?: undefined; guest: string };

/** One picked player from the request: { id } for a member, { guest } for a 路人. */
function readPlayer(v: unknown): Pick1 {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.id === "string" && o.id) return { id: o.id };
  if (typeof o.guest === "string") {
    const guest = o.guest.trim();
    if (guest.length > GUEST_NAME_MAX) throw badRequest(`路人的名字最多 ${GUEST_NAME_MAX} 个字`);
    return { guest };
  }
  throw badRequest("请选好双方的人");
}

/**
 * Records a match: { doubles, partner?: player, opponents: player[], games: [[a, b], ...], replaces? }.
 * `replaces` is one of their own unconfirmed matches, taken away as this one goes in (改了重新提交).
 * Pushes to every other member on court. Answers the new match's id.
 */
export async function recordMatch(env: Env, m: MemberRow, e: EventRow, body: Record<string, unknown>): Promise<number> {
  await mustRecord(env, m, e);
  const doubles = body.doubles === true;
  const games = checkGames(body.games);
  if (typeof games === "string") throw badRequest(games);
  const opponents = Array.isArray(body.opponents) ? body.opponents.map(readPlayer) : [];
  const partner = doubles ? [readPlayer(body.partner)] : [];
  if (opponents.length !== (doubles ? 2 : 1)) throw badRequest("请选好双方的人");
  if (!opponents.some((p) => p.id)) throw badRequest("对方至少要有一位群友");
  const ids = [...partner, ...opponents].flatMap((p) => (p.id ? [p.id] : []));
  if (ids.includes(m.id) || new Set(ids).size !== ids.length) throw badRequest("同一个人不能出现两次");
  for (const id of ids) if (!(await played(env, e.id, id))) throw badRequest("只能选这场来打球的人");

  const replaces = Number(body.replaces);
  if (body.replaces !== undefined && body.replaces !== null) {
    const old = (await eventMatches(env, e.id, m.id)).find((x) => x.id === replaces);
    if (!old?.mine || old.status === "confirmed") throw badRequest("这条比分不能再改了");
  }

  const at = now();
  // One batch, so a match never stands without its players: they find it by who, when and where.
  const newId =
    "(SELECT id FROM matches WHERE event_id = ?1 AND recorded_by = ?2 AND created_at = ?3 ORDER BY id DESC LIMIT 1)";
  const seat = (side: number, slot: number, p: Pick1, answer: "ok" | null) =>
    env.DB.prepare(
      `INSERT INTO match_players (match_id, side, slot, member_id, guest_name, answer, answered_at)
       VALUES (${newId}, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(e.id, m.id, at, side, slot, p.id ?? null, p.id ? null : p.guest, answer, answer ? at : null);
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO matches (event_id, recorded_by, doubles, games, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    ).bind(e.id, m.id, doubles ? 1 : 0, JSON.stringify(games), at),
    seat(0, 0, { id: m.id }, "ok"),
    ...partner.map((p, i) => seat(0, i + 1, p, null)),
    ...opponents.map((p, i) => seat(1, i, p, null)),
    ...(body.replaces !== undefined && body.replaces !== null ? removeMatch(env, replaces) : []),
  ]);
  const id = (inserted!.results[0] as { id: number }).id;
  const names = async (list: Pick1[]) =>
    Promise.all(
      list.map(async (p) =>
        p.id
          ? ((
              await env.DB.prepare("SELECT username FROM members WHERE id = ?").bind(p.id).first<{ username: string }>()
            )?.username ?? "")
          : p.guest || "路人",
      ),
    );
  const left = [m.username, ...(await names(partner))].join(" / ");
  const right = (await names(opponents)).join(" / ");
  await pushScore(env, e, ids, {
    title: `${m.username} 记录了一场${doubles ? "双打" : "单打"}，请确认`,
    body: `${left} 对 ${right}  ${games.map(([a, b]) => `${a}:${b}`).join("  ")}`,
    tag: `score-${id}`,
  });
  return id;
}

const removeMatch = (env: Env, id: number) => [
  env.DB.prepare("DELETE FROM match_players WHERE match_id = ?").bind(id),
  env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id),
];

/** A member on court confirms the score or says it's wrong, while it waits for them. */
export async function answerMatch(env: Env, m: MemberRow, e: EventRow, matchId: number, ok: boolean): Promise<void> {
  await mustBeOn(env);
  if (m.status !== "active") throw badRequest("你的账号已停用");
  const x = (await eventMatches(env, e.id, m.id)).find((x) => x.id === matchId);
  if (!x?.toAnswer) throw badRequest("这条比分不用你确认了");
  await env.DB.prepare(
    "UPDATE match_players SET answer = ?, answered_at = ? WHERE match_id = ? AND member_id = ? AND answer IS NULL",
  )
    .bind(ok ? "ok" : "no", now(), matchId, m.id)
    .run();
  if (!ok) {
    const recorder = await env.DB.prepare("SELECT recorded_by FROM matches WHERE id = ?")
      .bind(matchId)
      .first<{ recorded_by: string }>();
    if (recorder)
      await pushScore(env, e, [recorder.recorded_by], {
        title: `${m.username} 说比分不对`,
        body: `${x.games.map(([a, b]) => `${a}:${b}`).join("  ")} 这条不算数，可以改了重新提交。`,
        tag: `score-${matchId}`,
      });
  }
}

/** The recorder takes back one of their matches that isn't confirmed. */
export async function deleteMatch(env: Env, m: MemberRow, e: EventRow, matchId: number): Promise<void> {
  await mustBeOn(env);
  const x = (await eventMatches(env, e.id, m.id)).find((x) => x.id === matchId);
  if (!x?.mine) throw badRequest("只能删除自己记录的比分");
  if (x.status === "confirmed") throw badRequest("已确认的比分不能删除");
  await env.DB.batch(removeMatch(env, matchId));
}

/** An event's matches go with it. */
export const deleteEventMatches = (env: Env, eventId: number) => [
  env.DB.prepare("DELETE FROM match_players WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)").bind(
    eventId,
  ),
  env.DB.prepare("DELETE FROM matches WHERE event_id = ?").bind(eventId),
];
