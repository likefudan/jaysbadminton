import {
  BOOKED_COURTS_MAX,
  BOOKED_COURT_MAX,
  type EventDetail,
  type EventStatus,
  type EventSummary,
  type RosterEntry,
} from "../shared/types";
import { isDate, isTime, pacificToUtc, toPacific } from "../shared/time";
import { getSettings, now, setSetting } from "./db";
import { syncDeadline } from "./deadlines";
import { codeOf, eventNumberBase, nextEventNumber, parsePaymentCode } from "./paymentCode";
import type { Env } from "./env";
import { HttpError, badRequest } from "./http";
import { eventManager, eventPayee, lastKey, ownerId } from "./organizers";
import { payeeName } from "./payees";
import { deleteQueue } from "./courtQueue";

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
  notes: string;
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
  /** 球场排队: minutes per round on the hall's courts; null when the event doesn't use it. */
  queue_round_min: number | null;
  /** 预定场地: JSON array of the hall's court numbers booked for it; read through bookedCourts. */
  booked_courts: string;
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
    notes: e.notes,
    queueRoundMin: e.queue_round_min,
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
  const [payee, manager] = await Promise.all([eventPayee(env.DB, e), eventManager(env.DB, e)]);
  const payeeLabel = await payeeName(env.DB, payee);
  const managerLabel = manager === payee ? payeeLabel : await payeeName(env.DB, manager);
  return {
    ...toSummary(e, list.length),
    courts: bookedCourts(e),
    roster: list,
    dunningStopped: e.dunning_stopped === 1,
    deletable: isDeletable(e),
    payee: { id: payee, name: payeeLabel, isMe: !!payee && payee === viewer },
    manager: { id: manager, name: managerLabel, isMe: !!manager && manager === viewer },
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
    ...deleteQueue(env, e.id),
    env.DB.prepare("DELETE FROM calories WHERE event_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM calorie_uploads WHERE event_id = ?").bind(e.id),
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
  /**
   * Who runs it and is paid for it: whoever creates it (the Owner when left out). Its time, venue
   * and deadline become that person's next 新建活动 defaults (lastKey).
   */
  managerId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  address: string;
  title?: string;
  notes?: string;
  /** 球场排队 on, with this many minutes per round; null or left out keeps it off. */
  queueRoundMin?: number | null;
  deadlineDays: number;
  deadlineHours: number;
  /**
   * 群主 and 管理员 may create an event that has already started (to record one after the fact, or
   * to test something tied to its time, like 卡路里). It is created closed, quietly: see createEvent.
   */
  allowPast?: boolean;
}

export function validateEventInput(i: CreateEventInput): {
  startAt: string;
  endAt: string;
  deadlineAt: string;
  offsetMin: number;
  /** Already started (allowPast only): created closed. */
  started: boolean;
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
  const ts = now();
  const started = !!i.allowPast && startAt <= ts;
  if (deadlineAt <= ts && !started) throw badRequest("按这个提前量算出的截止时间已经过了，请调整");
  if (started && Date.parse(ts) - Date.parse(startAt) > PAST_DAYS_MAX * 86400_000)
    throw badRequest(`已经开始的活动最多补建 ${PAST_DAYS_MAX} 天内的`);
  return { startAt, endAt, deadlineAt, offsetMin, started };
}

export const TITLE_MAX = 30;
/** How far back allowPast reaches: enough for 卡路里 (30 days), and a mistyped year is caught. */
export const PAST_DAYS_MAX = 30;

/** The optional event title, trimmed; too long is refused rather than cut. */
export function cleanTitle(title: string | undefined): string {
  const t = (title ?? "").trim();
  if ([...t].length > TITLE_MAX) throw badRequest(`活动标题最多 ${TITLE_MAX} 个字`);
  return t;
}

export function cleanNotes(notes: string | undefined): string {
  const value = (notes ?? "").trim();
  if ([...value].length > 1000) throw badRequest("备注最多 1000 个字");
  return value;
}

/** 预定场地 as stored; anything unreadable counts as none. */
export function bookedCourts(e: { booked_courts?: string | null }): number[] {
  try {
    const list = JSON.parse(e.booked_courts ?? "[]");
    return Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/** 预定场地 from the admin page: whole numbers 1–99, each once, in order. */
export function cleanBookedCourts(v: unknown): number[] {
  if (!Array.isArray(v)) throw badRequest("场地编号不对");
  const list = v.map(Number);
  if (list.some((n) => !Number.isInteger(n) || n < 1 || n > BOOKED_COURT_MAX))
    throw badRequest(`场地编号请填 1–${BOOKED_COURT_MAX}`);
  const out = [...new Set(list)].sort((a, b) => a - b);
  if (out.length > BOOKED_COURTS_MAX) throw badRequest(`最多 ${BOOKED_COURTS_MAX} 块场地`);
  return out;
}

export function checkVenue(venue: string, address: string): void {
  if (!venue.trim()) throw badRequest("请填写场馆");
  if ([...venue.trim()].length > 60) throw badRequest("场馆名最多 60 个字");
  if ([...address.trim()].length > 200) throw badRequest("地址最多 200 个字");
}

/**
 * Remembers a venue for the 最近的场馆 list: its address, and whether its last event used the
 * 排队系统 (queuing goes with the hall).
 */
export function saveVenue(
  env: Env,
  venue: string,
  address: string,
  queueRoundMin: number | null,
  ts: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO locations (name, address, queue_round_min, last_used_at, use_count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (name) DO UPDATE SET address = CASE WHEN excluded.address != '' THEN excluded.address ELSE address END,
       queue_round_min = excluded.queue_round_min, last_used_at = excluded.last_used_at, use_count = use_count + 1`,
  ).bind(venue, address, queueRoundMin, ts);
}

/** started: it had already started (allowPast), so it was made closed and is to be kept quiet. */
export async function createEvent(env: Env, input: CreateEventInput): Promise<{ event: EventRow; started: boolean }> {
  const v = validateEventInput(input);
  const location = input.location.trim();
  const address = input.address.trim();
  const title = cleanTitle(input.title);
  const notes = cleanNotes(input.notes);
  const ts = now();
  const owner = await ownerId(env.DB);
  const manager = input.managerId ?? owner;
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
        `INSERT INTO events (number, code, date, start_at, end_at, location, address, title, notes, queue_round_min, deadline_at, deadline_offset_min, status, created_at, manager_id, payee_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
          notes,
          input.queueRoundMin ?? null,
          v.deadlineAt,
          v.offsetMin,
          // Already started: closed from the start, with no 报名截止 notice for a deadline long gone.
          v.started ? "closed" : "open",
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
  const key = (k: string) => lastKey(k, manager, owner);
  await env.DB.batch(
    v.started
      ? // An after-the-fact or test event: no 报名截止 for a deadline long gone, and the next
        // 新建活动 form and 最近的场馆 stay as the real events left them.
        [
          env.DB.prepare(
            "INSERT OR IGNORE INTO notification_log (event_id, type, sent_on, sent_at) VALUES (?, 'closed', ?, ?)",
          ).bind(id, v.deadlineAt, ts),
        ]
      : [
          saveVenue(env, location, address, input.queueRoundMin ?? null, ts),
          setSetting(env.DB, key("last_start_time"), input.startTime),
          setSetting(env.DB, key("last_end_time"), input.endTime),
          setSetting(env.DB, key("last_location"), location),
          setSetting(env.DB, key("last_deadline_offset_min"), String(v.offsetMin)),
        ],
  );
  await syncDeadline(env, id);
  return { event: await getEvent(env, id), started: v.started };
}

/** Statuses in which the roster may still change (by the Owner). */
export const ROSTER_EDITABLE: EventStatus[] = ["open", "closed", "finalized"];
/** ROSTER_EDITABLE inside SQL: events that are not archived yet (still taking sign-ups, waiting for Finalize, or collecting). */
export const LIVE_SQL = `(${ROSTER_EDITABLE.map((s) => `'${s}'`).join(", ")})`;

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

/** Returns whether anything was removed (false: they were not signed up, e.g. a second click). */
export async function removeSignup(env: Env, eventId: number, memberId: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM registrations WHERE event_id = ? AND member_id = ?")
    .bind(eventId, memberId)
    .run();
  return r.meta.changes > 0;
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
