import type { EventDetail, EventStatus, EventSummary, RosterEntry } from "../shared/types";
import { isDate, isTime, pacificToUtc, toPacific } from "../shared/time";
import { getSettings, now, setSetting } from "./db";
import { syncDeadline } from "./deadlines";
import { codeOf, eventNumberBase, nextEventNumber, parsePaymentCode } from "./paymentCode";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { eventManager, eventPayee, ownerId } from "./organizers";
import { payeeName } from "./payees";

export interface EventRow {
  id: number;
  /** 活动编号, e.g. jbm20261006b: fixed at creation, never changed or reused; payment codes carry it. */
  number: string;
  code: string;
  date: string;
  start_at: string;
  end_at: string;
  location: string;
  address: string;
  title: string;
  deadline_at: string;
  deadline_offset_min: number;
  status: EventStatus;
  finalized_at: string | null;
  settled_at: string | null;
  dunning_stopped: number;
  created_at: string;
  /** 负责人 and 收款人; NULL means the Owner. Read them through eventManager / eventPayee. */
  manager_id: string | null;
  payee_id: string | null;
}

interface RosterRow {
  id: number;
  member_id: string;
  username: string;
  friend_index: number;
  friend_name: string | null;
  attended: number;
  added_by_owner: number;
}

export const DEFAULT_FRIEND_CAP = 3;

export const friendLabel = (memberName: string, index: number, name: string | null) =>
  name?.trim() || `${memberName}的朋友${index}`;

/**
 * An open event past its deadline reads as closed straight away; its deadline alarm (or the cron) or the
 * next write stores it. Read paths use this instead of writing to the database themselves.
 */
export const liveStatus = (e: EventRow): EventStatus =>
  e.status === "open" && e.deadline_at <= now() ? "closed" : e.status;

export function toSummary(e: EventRow, headcount: number): EventSummary {
  return {
    id: e.id,
    code: e.code,
    date: e.date,
    startTime: toPacific(e.start_at).time,
    endTime: toPacific(e.end_at).time,
    location: e.location,
    address: e.address,
    title: e.title,
    deadlineAt: e.deadline_at,
    status: liveStatus(e),
    headcount,
  };
}

/** Moves open events past their deadline to closed: from the cron, and before any write that depends on it. */
export async function closeExpired(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE events SET status = 'closed' WHERE status = 'open' AND deadline_at <= ?")
    .bind(now())
    .run();
}

export async function getEvent(env: Env, id: number): Promise<EventRow> {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  return e;
}

export async function headcounts(env: Env, ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT event_id, COUNT(*) AS n FROM registrations WHERE event_id IN (${ids.map(() => "?").join(",")}) GROUP BY event_id`,
  )
    .bind(...ids)
    .all<{ event_id: number; n: number }>();
  return new Map(results.map((r) => [r.event_id, r.n]));
}

export async function summaries(env: Env, rows: EventRow[]): Promise<EventSummary[]> {
  const counts = await headcounts(
    env,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toSummary(r, counts.get(r.id) ?? 0));
}

export async function roster(env: Env, eventId: number): Promise<RosterEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.member_id, m.username, r.friend_index, r.friend_name, r.attended, r.added_by_owner
     FROM registrations r JOIN members m ON m.id = r.member_id
     WHERE r.event_id = ? ORDER BY r.id`,
  )
    .bind(eventId)
    .all<RosterRow>();
  // Keep each member's friends right after them, in sign-up order of the member.
  const order = new Map<string, number>();
  for (const r of results) if (!order.has(r.member_id)) order.set(r.member_id, r.id);
  results.sort((a, b) => order.get(a.member_id)! - order.get(b.member_id)! || a.friend_index - b.friend_index);
  return results.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: r.username,
    friendIndex: r.friend_index,
    name: r.friend_index === 0 ? r.username : friendLabel(r.username, r.friend_index, r.friend_name),
    attended: r.attended === 1,
    addedByOwner: r.added_by_owner === 1,
  }));
}

/** The admin page's view of an event; `viewer` is whoever is looking (their member id). */
export async function detail(env: Env, e: EventRow, viewer: string | null): Promise<EventDetail> {
  const list = await roster(env, e.id);
  const payee = await eventPayee(env.DB, e);
  const manager = await eventManager(env.DB, e);
  return {
    ...toSummary(e, list.length),
    roster: list,
    dunningStopped: e.dunning_stopped === 1,
    deletable: isDeletable(e),
    payee: { id: payee, name: await payeeName(env.DB, payee), isMe: !!payee && payee === viewer },
    manager: { id: manager, name: await payeeName(env.DB, manager), isMe: !!manager && manager === viewer },
  };
}

/** Only history can be deleted for good: events that are archived (all paid) or cancelled. */
export const isDeletable = (e: EventRow): boolean => e.status === "settled" || e.status === "cancelled";

/**
 * 从数据库永久删除: removes the event and everything hanging off it in one transaction (children
 * first, for the foreign keys). Venmo payments matched to its bills go with it, both auto-matched
 * receipts and 待确认 rows the Owner linked by hand. Leaderboard, member spending and the Sheets
 * export are all computed from these tables, so the event simply stops counting everywhere.
 * Only its number, date and code are kept (deleted_events), so the number is never reused.
 */
export async function deleteEvent(env: Env, e: EventRow): Promise<void> {
  const bills = "SELECT id FROM payments WHERE event_id = ?1";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM inbound_payments WHERE linked_payment_id IN (${bills})`).bind(e.id),
    env.DB.prepare(`DELETE FROM payment_receipts WHERE payment_id IN (${bills})`).bind(e.id),
    env.DB.prepare("DELETE FROM payments WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM settlements WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM registrations WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM notification_log WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM event_audit WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM events WHERE id = ?").bind(e.id),
    env.DB.prepare("INSERT INTO deleted_events (id, number, code, date, deleted_at) VALUES (?, ?, ?, ?, ?)").bind(
      e.id,
      e.number,
      e.code,
      e.date,
      now(),
    ),
  ]);
}

export async function friendCap(env: Env): Promise<number> {
  const s = await getSettings(env.DB, ["friend_cap"]);
  const n = Number(s.friend_cap);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_FRIEND_CAP;
}

/** How many friends a member has on an event's list now. */
export async function friendCount(env: Env, eventId: number, memberId: string): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index > 0",
  )
    .bind(eventId, memberId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export interface CreateEventInput {
  /** Who runs it and is paid for it: whoever creates it (the Owner when left out). */
  managerId?: string | null;
  /**
   * Whether this event's time, venue and deadline become the next 新建活动 form's defaults. Shared
   * by everyone, so only the group's own (the Owner's) events set them; an organizer's leave them.
   */
  rememberDefaults?: boolean;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  address: string;
  title?: string;
  deadlineDays: number;
  deadlineHours: number;
}

export function validateEventInput(i: CreateEventInput): {
  startAt: string;
  endAt: string;
  deadlineAt: string;
  offsetMin: number;
} {
  if (!isDate(i.date)) throw badRequest("请选择日期");
  if (!isTime(i.startTime) || !isTime(i.endTime)) throw badRequest("请填写开始和结束时间");
  checkVenue(i.location, i.address);
  const days = Math.floor(i.deadlineDays);
  const hours = Math.floor(i.deadlineHours);
  if (!(days >= 0 && days <= 14 && hours >= 0 && hours <= 23))
    throw badRequest("截止时间请选择提前 0–14 天、0–23 小时");
  const startAt = pacificToUtc(i.date, i.startTime);
  let endAt = pacificToUtc(i.date, i.endTime);
  // An end time earlier than the start means the session runs past midnight.
  if (endAt <= startAt) endAt = new Date(Date.parse(endAt) + 86400_000).toISOString();
  const offsetMin = days * 1440 + hours * 60;
  const deadlineAt = new Date(Date.parse(startAt) - offsetMin * 60_000).toISOString();
  if (deadlineAt <= now()) throw badRequest("按这个提前量算出的截止时间已经过了，请调整");
  return { startAt, endAt, deadlineAt, offsetMin };
}

export const TITLE_MAX = 30;

/** The optional event title, trimmed; too long is refused rather than cut. */
export function cleanTitle(title: string | undefined): string {
  const t = (title ?? "").trim();
  if ([...t].length > TITLE_MAX) throw badRequest(`活动标题最多 ${TITLE_MAX} 个字`);
  return t;
}

export function checkVenue(venue: string, address: string): void {
  if (!venue.trim()) throw badRequest("请填写场馆");
  if ([...venue.trim()].length > 60) throw badRequest("场馆名最多 60 个字");
  if ([...address.trim()].length > 200) throw badRequest("地址最多 200 个字");
}

/** Remembers a venue and its address for the 最近的场馆 list. */
export function saveVenue(env: Env, venue: string, address: string, ts: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO locations (name, address, last_used_at, use_count) VALUES (?, ?, ?, 1)
     ON CONFLICT (name) DO UPDATE SET address = CASE WHEN excluded.address != '' THEN excluded.address ELSE address END,
       last_used_at = excluded.last_used_at, use_count = use_count + 1`,
  ).bind(venue, address, ts);
}

export async function createEvent(env: Env, input: CreateEventInput): Promise<EventRow> {
  const v = validateEventInput(input);
  const location = input.location.trim();
  const address = input.address.trim();
  const title = cleanTitle(input.title);
  const ts = now();
  const manager = input.managerId ?? (await ownerId(env.DB));
  // The 活动编号 skips every number an event created on this date has ever had (including events
  // since moved to another date or deleted), so no number is handed out twice. If two requests race
  // for the same one, the unique index refuses the second insert and it takes the next letter.
  // From before numbers existed, codes of moved events and the numbers printed on bills count too:
  // either may be one this day's number would otherwise repeat.
  const base = eventNumberBase(input.date);
  let id: number | undefined;
  for (let attempt = 0; id === undefined; attempt++) {
    const { results } = await env.DB.prepare(
      `SELECT number FROM events WHERE number GLOB ?1 UNION SELECT number FROM deleted_events WHERE number GLOB ?1
       UNION SELECT 'jbm' || ?2 || lower(code) FROM events WHERE code GLOB ?3 AND substr(date, 1, 4) = ?2
       UNION SELECT 'jbm' || ?2 || lower(code) FROM deleted_events WHERE code GLOB ?3 AND substr(date, 1, 4) = ?2`,
    )
      .bind(`${base}*`, input.date.slice(0, 4), `${base.slice(7)}*`)
      .all<{ number: string }>();
    const billed = await env.DB.prepare("SELECT payment_code FROM payments WHERE lower(payment_code) GLOB ?")
      .bind(`*-${base}*`)
      .all<{ payment_code: string }>();
    const taken = new Set([
      ...results.map((r) => r.number),
      ...billed.results.map((r) => parsePaymentCode(r.payment_code)?.number ?? ""),
    ]);
    const number = nextEventNumber(input.date, taken);
    if (!number) throw badRequest("同一天的活动太多了");
    try {
      const res = await env.DB.prepare(
        `INSERT INTO events (number, code, date, start_at, end_at, location, address, title, deadline_at, deadline_offset_min, status, created_at, manager_id, payee_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?) RETURNING id`,
      )
        .bind(
          number,
          codeOf(number),
          input.date,
          v.startAt,
          v.endAt,
          location,
          address,
          title,
          v.deadlineAt,
          v.offsetMin,
          ts,
          manager,
          manager,
        )
        .first<{ id: number }>();
      id = res!.id;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
      if (attempt >= 2) throw badRequest("同时创建的活动太多，请稍后再试");
    }
  }
  await env.DB.batch([
    saveVenue(env, location, address, ts),
    ...(input.rememberDefaults === false
      ? []
      : [
          setSetting(env.DB, "last_start_time", input.startTime),
          setSetting(env.DB, "last_end_time", input.endTime),
          setSetting(env.DB, "last_location", location),
          setSetting(env.DB, "last_deadline_offset_min", String(v.offsetMin)),
        ]),
  ]);
  await syncDeadline(env, id);
  return getEvent(env, id);
}

/** Statuses in which the roster may still change (by the Owner). */
export const ROSTER_EDITABLE: EventStatus[] = ["open", "closed", "finalized"];

export function assertRosterEditable(e: EventRow): void {
  if (e.status === "settled") throw badRequest("这个活动已收齐归档，不能再修改");
  if (e.status === "cancelled") throw badRequest("这个活动已取消");
}

/**
 * Replaces a member's sign-up (themselves plus friends) for an event. Friend names that are
 * blank fall back to "<member>的朋友<n>" at display time.
 */
export async function setSignup(
  env: Env,
  eventId: number,
  memberId: string,
  friends: string[],
  addedByOwner: boolean,
): Promise<void> {
  const ts = now();
  const existing = await env.DB.prepare(
    "SELECT friend_index, attended, created_at, added_by_owner FROM registrations WHERE event_id = ? AND member_id = ?",
  )
    .bind(eventId, memberId)
    .all<{ friend_index: number; attended: number; created_at: string; added_by_owner: number }>();
  const prev = new Map(existing.results.map((r) => [r.friend_index, r]));
  // Friends keep the numbers they already have, in order, so a gap left by the Owner removing one
  // doesn't shift the rest onto another friend's row (and its 到场 mark); new ones go after them.
  const held = [...prev.keys()].filter((i) => i > 0).sort((a, b) => a - b);
  const indexes = friends.map((_, n) => held[n] ?? (held.at(-1) ?? 0) + n - held.length + 1);
  const rows = [
    { i: 0, name: null },
    ...friends.map((name, n) => ({ i: indexes[n]!, name: name.trim().slice(0, 20) || null })),
  ];
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM registrations WHERE event_id = ? AND member_id = ? AND friend_index > 0
         AND friend_index NOT IN (SELECT value FROM json_each(?))`,
    ).bind(eventId, memberId, JSON.stringify(indexes)),
    ...rows.map((r) =>
      env.DB.prepare(
        `INSERT INTO registrations (event_id, member_id, friend_index, friend_name, attended, added_by_owner, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id, member_id, friend_index) DO UPDATE SET friend_name = excluded.friend_name, updated_at = excluded.updated_at`,
      ).bind(
        eventId,
        memberId,
        r.i,
        r.name,
        prev.get(r.i)?.attended ?? 1,
        prev.get(r.i)?.added_by_owner ?? (addedByOwner ? 1 : 0),
        prev.get(r.i)?.created_at ?? ts,
        ts,
      ),
    ),
  ]);
}

export async function removeSignup(env: Env, eventId: number, memberId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM registrations WHERE event_id = ? AND member_id = ?").bind(eventId, memberId).run();
}

/** keep: friends already on the list, which may stay even above the cap (the Owner may have added them). */
export function validateFriends(raw: unknown, cap: number | null, keep = 0): string[] {
  if (!Array.isArray(raw)) throw badRequest("朋友名单格式不对");
  const friends = raw.map((f) => (typeof f === "string" ? f : ""));
  if (cap !== null && friends.length > Math.max(cap, keep))
    throw badRequest(
      keep > cap ? `最多带 ${cap} 个朋友；现在的 ${keep} 个可以保留，但不能再加` : `最多带 ${cap} 个朋友`,
    );
  if (friends.length > Math.max(20, keep)) throw badRequest("朋友太多了");
  return friends;
}
