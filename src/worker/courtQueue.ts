import {
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_MINUTES_MAX,
  QUEUE_ROUND_MAX,
  QUEUE_ROUND_MIN,
  type QueueInfo,
} from "../shared/courtQueue";
import { now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest, HttpError } from "./http";

/** Courts and accounts stay on the card this long after the event ends, then the part goes away. */
const AFTER_END_MS = 3 * 3600_000;
const ACCOUNTS_MAX = 60;
const COURTS_MAX = 40;
const FIELD_MAX = 30;

/** The event's 每轮分钟数 from the event form: null turns 球场排队 off. */
export function cleanRoundMin(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === false) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < QUEUE_ROUND_MIN || n > QUEUE_ROUND_MAX)
    throw badRequest(`每轮时间请填 ${QUEUE_ROUND_MIN}–${QUEUE_ROUND_MAX} 分钟`);
  return n;
}

/** On for this event and not long over: players can see and change its courts and accounts. */
export const queueLive = (e: EventRow, at = now()): boolean =>
  e.queue_round_min !== null &&
  e.status !== "cancelled" &&
  Date.parse(at) <= Date.parse(e.end_at) + AFTER_END_MS;

/** Everything the card shows: shared accounts (with who added them) and the courts entered. */
export async function queueInfo(env: Env, e: EventRow, viewer: string): Promise<QueueInfo> {
  const [accounts, courts] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.username, a.password, a.member_id, m.username AS by_name
       FROM queue_accounts a JOIN members m ON m.id = a.member_id
       WHERE a.event_id = ? ORDER BY a.id`,
    )
      .bind(e.id)
      .all<{ id: number; username: string; password: string; member_id: string; by_name: string }>(),
    env.DB.prepare(
      `SELECT c.id, c.court, c.position, c.minutes_left, c.accounts, c.entered_at, m.username AS by_name
       FROM queue_courts c JOIN members m ON m.id = c.entered_by
       WHERE c.event_id = ? ORDER BY c.court, c.position`,
    )
      .bind(e.id)
      .all<{
        id: number;
        court: number;
        position: number;
        minutes_left: number;
        accounts: string;
        entered_at: string;
        by_name: string;
      }>(),
  ]);
  return {
    roundMin: e.queue_round_min!,
    accounts: accounts.results.map((a) => ({
      id: a.id,
      username: a.username,
      password: a.password,
      addedBy: a.by_name,
      mine: a.member_id === viewer,
    })),
    courts: courts.results.map((c) => ({
      id: c.id,
      court: c.court,
      position: c.position,
      minutesLeft: c.minutes_left,
      accounts: JSON.parse(c.accounts) as string[],
      enteredAt: c.entered_at,
      enteredBy: c.by_name,
    })),
  };
}

function field(v: unknown, what: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw badRequest(`请填写${what}`);
  if ([...s].length > FIELD_MAX) throw badRequest(`${what}最多 ${FIELD_MAX} 个字`);
  return s;
}

export async function addAccount(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  const username = field(body.username, "用户名");
  const password = field(body.password, "密码");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM queue_accounts WHERE event_id = ?")
    .bind(e.id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= ACCOUNTS_MAX) throw badRequest(`每场最多 ${ACCOUNTS_MAX} 个账号`);
  const res = await env.DB.prepare(
    `INSERT INTO queue_accounts (event_id, member_id, username, password, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (event_id, username) DO NOTHING`,
  )
    .bind(e.id, memberId, username, password, now())
    .run();
  if (!res.meta.changes) throw badRequest(`账号 ${username} 已经有人填过了`);
}

/** Taken off by whoever added it, or by whoever runs the event. */
export async function removeAccount(env: Env, e: EventRow, memberId: string, runs: boolean, id: number) {
  const res = await env.DB.prepare(
    "DELETE FROM queue_accounts WHERE id = ? AND event_id = ? AND (member_id = ? OR ?)",
  )
    .bind(id, e.id, memberId, runs ? 1 : 0)
    .run();
  if (!res.meta.changes) throw badRequest("只能删除自己填的账号");
}

function int(v: unknown, min: number, max: number, message: string): number {
  const n = typeof v === "number" ? v : Number(typeof v === "string" && v.trim() ? v : Number.NaN);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(message);
  return n;
}

/**
 * 登记球场: a new court entry, or (with id) a correction of one, which counts again from now. The
 * group must be accounts shared on the event, so the card can say whose they are.
 */
export async function saveCourt(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  const court = int(body.court, 1, QUEUE_COURT_MAX, "请选择场号");
  const position = int(body.position, 0, QUEUE_MAX_POSITION, "请选择在打还是排第几组");
  const minutes = int(body.minutesLeft, 0, QUEUE_MINUTES_MAX, `剩余时间请填 0–${QUEUE_MINUTES_MAX} 分钟`);
  const picked = Array.isArray(body.accounts) ? body.accounts.filter((a): a is string => typeof a === "string") : [];
  const { results } = await env.DB.prepare("SELECT username FROM queue_accounts WHERE event_id = ?")
    .bind(e.id)
    .all<{ username: string }>();
  const known = new Map(results.map((r) => [r.username.toLowerCase(), r.username]));
  const group = [...new Set(picked.map((a) => known.get(a.trim().toLowerCase())))];
  if (group.includes(undefined)) throw badRequest("选的账号已经被删掉了，请刷新后再选");
  if (group.length < 1 || group.length > QUEUE_GROUP_MAX) throw badRequest(`请选 1–${QUEUE_GROUP_MAX} 个账号`);
  const accounts = JSON.stringify(group);
  const ts = now();
  if (body.id !== undefined && body.id !== null) {
    const id = int(body.id, 1, Number.MAX_SAFE_INTEGER, "找不到这条记录");
    const res = await env.DB.prepare(
      `UPDATE queue_courts SET court = ?, position = ?, minutes_left = ?, accounts = ?, entered_at = ?, entered_by = ?
       WHERE id = ? AND event_id = ?`,
    )
      .bind(court, position, minutes, accounts, ts, memberId, id, e.id)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "not_found", "这条记录已经被删掉了");
    return;
  }
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM queue_courts WHERE event_id = ?")
    .bind(e.id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= COURTS_MAX) throw badRequest("登记的球场太多了，请先删掉打完的");
  await env.DB.prepare(
    `INSERT INTO queue_courts (event_id, court, position, minutes_left, accounts, entered_at, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(e.id, court, position, minutes, accounts, ts, memberId)
    .run();
}

/** Anyone on the event may take a court off: the list is everyone's to keep current. */
export async function removeCourt(env: Env, e: EventRow, id: number) {
  await env.DB.prepare("DELETE FROM queue_courts WHERE id = ? AND event_id = ?").bind(id, e.id).run();
}

/** For deleteEvent: the event's courts and accounts go with it. */
export const deleteQueue = (env: Env, eventId: number): D1PreparedStatement[] => [
  env.DB.prepare("DELETE FROM queue_courts WHERE event_id = ?").bind(eventId),
  env.DB.prepare("DELETE FROM queue_accounts WHERE event_id = ?").bind(eventId),
];
