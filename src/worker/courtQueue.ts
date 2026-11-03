import {
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_MINUTES_MAX,
  QUEUE_ROUND_MAX,
  QUEUE_ROUND_MIN,
  type QueueInfo,
} from "../shared/courtQueue";
import { photoEnabled } from "./courtPhoto";
import { now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest, HttpError } from "./http";

/** Courts and accounts stay on the card this long after the event ends, then the part goes away. */
const AFTER_END_MS = 3 * 3600_000;
const ACCOUNTS_MAX = 100;
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
  e.queue_round_min !== null && e.status !== "cancelled" && Date.parse(at) <= Date.parse(e.end_at) + AFTER_END_MS;

/** Everything the card shows: shared accounts (with who added them) and the courts entered. */
export async function queueInfo(env: Env, e: EventRow, viewer: string, manage: boolean): Promise<QueueInfo> {
  const [accounts, courts] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.username, a.password, a.member_id, m.username AS by_name
       FROM queue_accounts a JOIN members m ON m.id = a.member_id
       WHERE a.event_id = ? ORDER BY a.id`,
    )
      .bind(e.id)
      .all<{ id: number; username: string; password: string; member_id: string; by_name: string }>(),
    env.DB.prepare(
      `SELECT c.id, c.court, c.position, c.starts_at, c.ends_at, c.accounts, c.created_at, c.updated_at,
              cm.username AS created_name, um.username AS updated_name
       FROM queue_courts c JOIN members cm ON cm.id = c.created_by JOIN members um ON um.id = c.updated_by
       WHERE c.event_id = ? ORDER BY c.court, c.position`,
    )
      .bind(e.id)
      .all<{
        id: number;
        court: number;
        position: number;
        starts_at: string | null;
        ends_at: string;
        accounts: string;
        created_at: string;
        updated_at: string;
        created_name: string;
        updated_name: string;
      }>(),
  ]);
  return {
    roundMin: e.queue_round_min!,
    photo: photoEnabled(env),
    manage,
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
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      accounts: JSON.parse(c.accounts) as string[],
      createdBy: c.created_name,
      createdAt: c.created_at,
      updatedBy: c.updated_name,
      updatedAt: c.updated_at,
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

/**
 * 批量添加: several accounts at once, as parsed on the phone from a pasted list. Usernames already
 * on the event (any case) are skipped and named back, not overwritten.
 */
export async function addAccounts(
  env: Env,
  e: EventRow,
  memberId: string,
  body: Record<string, unknown>,
): Promise<{ added: number; skipped: string[] }> {
  const list = Array.isArray(body.accounts) ? body.accounts : [];
  if (list.length === 0) throw badRequest("没有可以添加的账号");
  if (list.length > ACCOUNTS_MAX) throw badRequest(`每场最多 ${ACCOUNTS_MAX} 个账号`);
  const accounts = list.map((a) => {
    const r = (a ?? {}) as Record<string, unknown>;
    return { username: field(r.username, "用户名"), password: field(r.password, "密码") };
  });
  const { results } = await env.DB.prepare("SELECT username FROM queue_accounts WHERE event_id = ?")
    .bind(e.id)
    .all<{ username: string }>();
  const taken = new Set(results.map((r) => r.username.toLowerCase()));
  const skipped: string[] = [];
  const fresh = accounts.filter((a) => {
    const key = a.username.toLowerCase();
    if (taken.has(key)) {
      skipped.push(a.username);
      return false;
    }
    taken.add(key);
    return true;
  });
  if (results.length + fresh.length > ACCOUNTS_MAX)
    throw badRequest(`每场最多 ${ACCOUNTS_MAX} 个账号，现在已有 ${results.length} 个`);
  if (fresh.length) {
    const ts = now();
    await env.DB.batch(
      fresh.map((a) =>
        env.DB.prepare(
          `INSERT INTO queue_accounts (event_id, member_id, username, password, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (event_id, username) DO NOTHING`,
        ).bind(e.id, memberId, a.username, a.password, ts),
      ),
    );
  }
  return { added: fresh.length, skipped };
}

/** Taken off by whoever added it, or by whoever runs the event. */
export async function removeAccount(env: Env, e: EventRow, memberId: string, runs: boolean, id: number) {
  const res = await env.DB.prepare("DELETE FROM queue_accounts WHERE id = ? AND event_id = ? AND (member_id = ? OR ?)")
    .bind(id, e.id, memberId, runs ? 1 : 0)
    .run();
  if (!res.meta.changes) throw badRequest("只能删除自己填的账号");
}

/** 清空 (the Owner and admins only, checked by the route): every account on the event. Courts keep their names. */
export async function clearAccounts(env: Env, e: EventRow): Promise<number> {
  const res = await env.DB.prepare("DELETE FROM queue_accounts WHERE event_id = ?").bind(e.id).run();
  return res.meta.changes ?? 0;
}

function int(v: unknown, min: number, max: number, message: string): number {
  const n = typeof v === "number" ? v : Number(typeof v === "string" && v.trim() ? v : Number.NaN);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(message);
  return n;
}

/**
 * 登记球场 / 修改: a new court entry, or (with id) a change to one. `minutes` counts from now: the
 * time left while playing, or the wait until a queued group gets on (the form works that out from
 * the screen when a court is first entered). A queued group's round then runs roundMin minutes.
 * The group must be accounts shared on the event.
 *
 * The entry replaces what it makes out of date on the same court (a newer look at the hall's
 * screen wins): a court has one group playing, so a playing entry takes the place of any other
 * group playing there (including a queued group whose time has come); and a group waits in a
 * court's queue once, so a queued entry takes the place of the same group (any account in common)
 * still queued there. Without this, 拍照登记 or a second 登记 of a court already on the card added
 * it again (9号 twice under 在打).
 */
export async function saveCourt(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  const court = int(body.court, 1, QUEUE_COURT_MAX, "请选择场号");
  const position = int(body.position, 0, QUEUE_MAX_POSITION, "请选择在打还是排第几组");
  const minutes = int(
    body.minutes,
    position === 0 ? 1 : 0,
    QUEUE_MINUTES_MAX,
    `时间请填 ${position === 0 ? 1 : 0}–${QUEUE_MINUTES_MAX} 分钟`,
  );
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
  const at = (min: number) => new Date(Date.parse(ts) + min * 60_000).toISOString();
  const startsAt = position === 0 ? null : at(minutes);
  const endsAt = position === 0 ? at(minutes) : at(minutes + e.queue_round_min!);
  const editing = body.id !== undefined && body.id !== null;
  const id = editing ? int(body.id, 1, Number.MAX_SAFE_INTEGER, "找不到这条记录") : 0;
  if (editing) {
    const found = await env.DB.prepare("SELECT 1 FROM queue_courts WHERE id = ? AND event_id = ?")
      .bind(id, e.id)
      .first();
    if (!found) throw new HttpError(404, "not_found", "这条记录已经被删掉了");
  } else {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM queue_courts WHERE event_id = ?")
      .bind(e.id)
      .first<{ n: number }>();
    if ((n?.n ?? 0) >= COURTS_MAX) throw badRequest("登记的球场太多了，请先删掉打完的");
  }
  // Run together with the write, so two phones entering the same court at once still leave one.
  const replaced =
    position === 0
      ? env.DB.prepare(
          `DELETE FROM queue_courts WHERE event_id = ? AND court = ? AND id != ? AND ends_at > ?
             AND (starts_at IS NULL OR starts_at <= ?)`,
        ).bind(e.id, court, id, ts, ts)
      : env.DB.prepare(
          `DELETE FROM queue_courts WHERE event_id = ? AND court = ? AND id != ? AND starts_at > ?
             AND EXISTS (SELECT 1 FROM json_each(queue_courts.accounts) j
                         WHERE lower(j.value) IN (SELECT lower(value) FROM json_each(?)))`,
        ).bind(e.id, court, id, ts, accounts);
  const write = editing
    ? env.DB.prepare(
        `UPDATE queue_courts SET court = ?, position = ?, starts_at = ?, ends_at = ?, accounts = ?, updated_at = ?, updated_by = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(court, position, startsAt, endsAt, accounts, ts, memberId, id, e.id)
    : env.DB.prepare(
        `INSERT INTO queue_courts (event_id, court, position, starts_at, ends_at, accounts, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(e.id, court, position, startsAt, endsAt, accounts, ts, memberId, ts, memberId);
  const [, res] = await env.DB.batch([replaced, write]);
  if (editing && !res!.meta.changes) throw new HttpError(404, "not_found", "这条记录已经被删掉了");
}

/** Anyone on the event may take a court off: the list is everyone's to keep current. */
export async function removeCourt(env: Env, e: EventRow, id: number) {
  await env.DB.prepare("DELETE FROM queue_courts WHERE id = ? AND event_id = ?").bind(id, e.id).run();
}

/** 批量删除 (the Owner and admins only, checked by the route): the ticked courts, playing or queued. */
export async function removeCourts(env: Env, e: EventRow, body: Record<string, unknown>): Promise<number> {
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
  if (ids.length === 0 || ids.length > COURTS_MAX || !ids.every((id) => Number.isInteger(id) && id > 0))
    throw badRequest("请先勾选要删除的球场");
  const res = await env.DB.prepare(
    `DELETE FROM queue_courts WHERE event_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
  )
    .bind(e.id, ...ids)
    .run();
  return res.meta.changes ?? 0;
}

/** For deleteEvent: the event's courts, accounts and photos go with it. */
export const deleteQueue = (env: Env, eventId: number): D1PreparedStatement[] => [
  env.DB.prepare("DELETE FROM queue_photos WHERE event_id = ?").bind(eventId),
  env.DB.prepare("DELETE FROM queue_courts WHERE event_id = ?").bind(eventId),
  env.DB.prepare("DELETE FROM queue_accounts WHERE event_id = ?").bind(eventId),
];
