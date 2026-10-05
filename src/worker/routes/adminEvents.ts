import { Hono } from "hono";
import { dollars, parseDollars, settle, type SettleInput } from "../../shared/settle";
import type { AdminEventSummary, EventDefaults, InboundResponse, SettlementView } from "../../shared/types";
import {
  addReceipt,
  assertCostsShared,
  checkCollected,
  finalize,
  markPaid,
  paymentRows,
  recomputeIfFinalized,
  savedInput,
  settleRows,
  syncPayments,
} from "../billing";
import { formatInstantZh, isDate, isTime, pacificToUtc, toPacific } from "../../shared/time";
import { getSettings, now, setSetting } from "../db";
import { clearDeadline, syncAllDeadlines, syncDeadline } from "../deadlines";
import type { Env } from "../env";
import {
  assertRosterEditable,
  closeExpired,
  createEvent,
  deleteEvent,
  detail,
  friendCap,
  friendCount,
  checkVenue,
  cleanTitle,
  getEvent,
  isDeletable,
  saveVenue,
  removeSignup,
  setSignup,
  summaries,
  validateFriends,
  type EventRow,
} from "../events";
import { HttpError, badRequest, readJson, str } from "../http";
import { checkPassword } from "../auth";
import type { Actor, AdminEnv } from "../access";
import {
  can,
  eventManager,
  eventPayee,
  forgetLastValue,
  inboundPayee,
  lastValues,
  organizersEnabled,
  ownerId,
  payeeProfile,
} from "../organizers";
import { assertOrganizersOn, handBackIfRevoked, remindIfExpired, transferEvent } from "../appointments";
import {
  assertAccountFree,
  assertPayeeReady,
  outstandingBills,
  payeeName,
  payeeSql,
  readPaymentInput,
  savePaymentProfile,
} from "../payees";
import { SITE_TITLE_MAX, siteTheme, siteTitle } from "../site";
import { isTheme } from "../../shared/themes";
import { requireMember } from "../members";
import {
  LINKABLE,
  LINK_ARCHIVED_DAYS,
  emailStatus,
  GMAIL_CONFIRM_HOURS,
  inboundRows,
  noteTarget,
  linkCutoff,
  openPayments,
  refundRows,
} from "../inbound";
import { message, notifyCreated, notifySettings } from "../notify";
import { resolveAddress, suggestAddresses } from "../places";
import { TABLES, isTable, toCsv } from "../export";
import { currentScript, disableExport, rotateExportKey, sheetsStatus } from "../sheets";
import { type ChatOwner, disconnect, sendToMember, sendToOwner, startBinding, telegramStatus } from "../telegram";
import { actorId, audit, auditRows, billOwner, friendName, money, record, rosterLabel } from "../audit";

/** Mounted under /api/admin/:token after the admin auth middleware, which has checked access.ts. */
export const adminEventRoutes = new Hono<AdminEnv>();

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** 已结束 shows this many at first; 显示更早的活动 asks for more (?past=60, 90, …). */
const PAST_PAGE = 30;

adminEventRoutes.get("/events", async (c) => {
  const want = Math.floor(Number(c.req.query("past") ?? PAST_PAGE));
  const limit = Number.isFinite(want) ? Math.min(Math.max(want, PAST_PAGE), 2000) : PAST_PAGE;
  // Without `group`, only the events one manages (NULL is the Owner's, so never an organizer's).
  // With it, ?manager= narrows the list to one person's (the Owner's own include NULL).
  const actor = c.get("actor");
  const group = can(actor.role, "group");
  const wanted = group ? c.req.query("manager") || null : actor.memberId;
  // Plain manager_id = ? keeps the events_manager index; NULL counts only when the Owner is wanted.
  // Without `group` the filter always applies (a null id matches nothing).
  const owner = group && wanted ? await ownerId(c.env.DB) : null;
  const filtered = !group || !!wanted;
  const mine = filtered ? [wanted] : [];
  const only = !filtered
    ? ""
    : group && wanted === owner
      ? "AND (manager_id = ? OR manager_id IS NULL)"
      : "AND manager_id = ?";
  const current = await c.env.DB.prepare(
    `SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ${only} ORDER BY start_at`,
  )
    .bind(...mine)
    .all<EventRow>();
  // One more than shown, to know whether there are older ones.
  const past = await c.env.DB.prepare(
    `SELECT * FROM events WHERE status IN ('settled', 'cancelled') ${only} ORDER BY start_at DESC LIMIT ?`,
  )
    .bind(...mine, limit + 1)
    .all<EventRow>();
  const shown = past.results.slice(0, limit);
  // Who runs each one, named once per person.
  const names = new Map<string | null, Promise<string>>();
  const withManager = async (list: EventRow[]): Promise<AdminEventSummary[]> => {
    const rows = await summaries(c.env, list);
    return Promise.all(
      rows.map(async (e, i) => {
        const id = await eventManager(c.env.DB, list[i]!);
        if (!names.has(id)) names.set(id, payeeName(c.env.DB, id));
        return { ...e, manager: { id, name: await names.get(id)! } };
      }),
    );
  };
  // For the Owner's 负责人 filter: everyone who has run an event, organizers since revoked too.
  const everyone = async () => {
    const { results } = await c.env.DB.prepare(
      "SELECT DISTINCT manager_id AS id FROM events WHERE manager_id IS NOT NULL",
    ).all<{ id: string }>();
    return Promise.all(results.map(async (m) => ({ id: m.id, name: await payeeName(c.env.DB, m.id) })));
  };
  const [cur, old, managers] = await Promise.all([
    withManager(current.results),
    withManager(shown),
    group && organizersEnabled(c.env) ? everyone() : [],
  ]);
  return c.json({ current: cur, past: old, morePast: past.results.length > limit, managers });
});

adminEventRoutes.get("/events/defaults", async (c) => {
  const s = await lastValues(c.env.DB, c.get("actor").memberId, [
    "last_start_time",
    "last_end_time",
    "last_location",
    "last_deadline_offset_min",
  ]);
  const offset = Number(s.last_deadline_offset_min ?? 1440);
  const { results } = await c.env.DB.prepare(
    "SELECT name, address FROM locations ORDER BY last_used_at DESC LIMIT 10",
  ).all<{
    name: string;
    address: string;
  }>();
  return c.json<EventDefaults>({
    startTime: s.last_start_time ?? "19:00",
    endTime: s.last_end_time ?? "21:00",
    location: s.last_location ?? "",
    address: results.find((r) => r.name === s.last_location)?.address ?? "",
    deadlineDays: Math.floor(offset / 1440),
    deadlineHours: Math.floor((offset % 1440) / 60),
    locations: results,
    friendCap: await friendCap(c.env),
  });
});

/** 最近的场馆 ✕: forgets a venue. Events keep their own copy of the venue and address. */
adminEventRoutes.post("/locations/remove", async (c) => {
  const name = str((await readJson(c.req.raw)).name);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM locations WHERE name = ?").bind(name),
    // Otherwise the next new event would still start with it filled in.
    ...forgetLastValue(c.env.DB, "last_location", name),
  ]);
  return c.json({ ok: true });
});

adminEventRoutes.post("/events", async (c) => {
  const b = await readJson(c.req.raw);
  const actor = c.get("actor");
  // Whoever creates it runs it and is paid for it (the Owner's own events, as before, are theirs).
  const e = await createEvent(c.env, {
    managerId: actor.memberId,
    date: str(b.date),
    startTime: str(b.startTime),
    endTime: str(b.endTime),
    location: str(b.location),
    address: str(b.address),
    title: str(b.title),
    deadlineDays: num(b.deadlineDays),
    deadlineHours: num(b.deadlineHours),
  });
  await audit(c.env, e.id, actorId(actor), "create", `创建活动（${e.date} ${e.location}）`);
  // Revoked while this request was on its way: the event goes to the Owner like their others did.
  if (actor.role === "organizer") await handBackIfRevoked(c.env, e.id, actor.memberId);
  await notifyCreated(c.env, await getEvent(c.env, e.id));
  // "我自己也报名": the creator signs up as a normal player (ticked by default in the form).
  if (b.joinSelf === true) {
    const self = await activeSelf(c.env, actor.memberId);
    if (self) {
      await setSignup(c.env, e.id, self, [], false);
      await audit(c.env, e.id, actorId(actor), "self_signup", "创建时自己报名");
    }
  }
  return c.json(await detail(c.env, await getEvent(c.env, e.id), c.get("actor").memberId));
});

/** The signed-in person's member id while they are an active member (they can play), else null. */
async function activeSelf(env: Env, memberId: string | null): Promise<string | null> {
  if (!memberId) return null;
  const m = await env.DB.prepare("SELECT id FROM members WHERE id = ? AND status = 'active' AND deleted_at IS NULL")
    .bind(memberId)
    .first<{ id: string }>();
  return m?.id ?? null;
}

/**
 * 我的报名: whoever runs the event signs themselves up (with friends) from the admin page.
 * Allowed until Finalize, like any roster edit before the bills exist; no friend cap.
 */
async function selfSignupEvent(env: Env, id: string, memberId: string | null) {
  await closeExpired(env);
  const e = await getEvent(env, Number(id));
  if (e.status !== "open" && e.status !== "closed")
    throw badRequest("已经结算，不能再改自己的报名；需要调整请直接改名单");
  const self = await activeSelf(env, memberId);
  if (!self) throw badRequest("找不到你本人的成员记录");
  return { e, self };
}

/** One's own rows on the roster (themselves and friends, with names), for telling whether a save changed them. */
async function ownSignup(env: Env, eventId: number, memberId: string) {
  const { results } = await env.DB.prepare(
    "SELECT friend_index, friend_name FROM registrations WHERE event_id = ? AND member_id = ? ORDER BY friend_index",
  )
    .bind(eventId, memberId)
    .all<{ friend_index: number; friend_name: string | null }>();
  return { rows: results, key: results.length ? JSON.stringify(results) : "" };
}

adminEventRoutes.post("/events/:id/self-signup", async (c) => {
  const { e, self } = await selfSignupEvent(c.env, c.req.param("id"), c.get("actor").memberId);
  const body = await readJson(c.req.raw);
  // No cap here, but friends already on the list (some may be added from 添加人员) may stay.
  const keep = await friendCount(c.env, e.id, self);
  const friends = validateFriends(body.friends ?? [], null, keep);
  const before = await ownSignup(c.env, e.id, self);
  await setSignup(c.env, e.id, self, friends, false);
  await audit(c.env, e.id, actorId(c.get("actor")), "self_signup", async () => {
    // Saved again without a change: nothing to record.
    const after = await ownSignup(c.env, e.id, self);
    if (before.key === after.key) return null;
    const what = before.key ? "修改自己的报名" : "自己报名";
    // Named as the roster now shows them (friend numbers are kept across saves).
    const me = await billOwner(c.env, self);
    const names = after.rows
      .filter((r) => r.friend_index > 0)
      .map((r) => friendName(me, r.friend_index, r.friend_name));
    return names.length ? `${what}，带 ${names.length} 个朋友：${names.join("、")}` : `${what}，不带朋友`;
  });
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

adminEventRoutes.post("/events/:id/self-cancel", async (c) => {
  const { e, self } = await selfSignupEvent(c.env, c.req.param("id"), c.get("actor").memberId);
  if (await removeSignup(c.env, e.id, self))
    await audit(c.env, e.id, actorId(c.get("actor")), "self_cancel", "取消自己的报名（连同带的朋友）");
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

adminEventRoutes.get("/events/:id", async (c) => {
  return c.json(await detail(c.env, await getEvent(c.env, Number(c.req.param("id"))), c.get("actor").memberId));
});

/** 操作记录: the Owner sees every event's, an organizer only those of the events they run (access.ts). */
adminEventRoutes.get("/events/:id/audit", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  return c.json({ entries: await auditRows(c.env, e.id) });
});

/** 转交 (Owner): another organizer, or the Owner, runs the event; before Finalize the money goes too. */
adminEventRoutes.post("/events/:id/transfer", async (c) => {
  assertOrganizersOn(c.env);
  const id = Number(c.req.param("id"));
  const before = await getEvent(c.env, id);
  await transferEvent(c.env, before.id, str((await readJson(c.req.raw)).to));
  const after = await getEvent(c.env, id);
  await audit(c.env, id, actorId(c.get("actor")), "transfer", async () => {
    // Compared as people (NULL is the Owner, as in eventManager / eventPayee), so handing an event
    // to whoever already runs it records nothing.
    const owner = await ownerId(c.env.DB);
    const [from, to, paidBefore, paidAfter] = [
      before.manager_id ?? owner,
      after.manager_id ?? owner,
      before.payee_id ?? owner,
      after.payee_id ?? owner,
    ];
    if (from === to) return null;
    const payee = paidBefore === paidAfter ? `，收款人仍是 ${await payeeName(c.env.DB, paidAfter)}` : "，收款人一起换";
    return `把活动从 ${await payeeName(c.env.DB, from)} 转交给 ${await payeeName(c.env.DB, to)}${payee}`;
  });
  return c.json(await detail(c.env, after, c.get("actor").memberId));
});

adminEventRoutes.post("/events/:id/cancel", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open" && e.status !== "closed") throw badRequest("只能在 Finalize 之前取消活动");
  // Guarded, so of two clicks at once only the one that cancelled it records it.
  const res = await c.env.DB.prepare(
    "UPDATE events SET status = 'cancelled' WHERE id = ? AND status IN ('open', 'closed')",
  )
    .bind(e.id)
    .run();
  if (!res.meta.changes) throw badRequest("只能在 Finalize 之前取消活动");
  await audit(c.env, e.id, actorId(c.get("actor")), "cancel", "取消活动");
  await syncDeadline(c.env, e.id);
  await remindIfExpired(c.env, e.payee_id);
  return c.json({ ok: true });
});

/**
 * 从数据库永久删除, for test events and other history the Owner wants gone. Needs the admin
 * password; the page also asks for confirmation. Reported to the Owner's Telegram like other
 * password-gated changes. D1 Time Travel can still restore the last 7 days if it was a mistake.
 */
adminEventRoutes.post("/events/:id/delete", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (!(await checkPassword(c.env, str((await readJson(c.req.raw)).password))))
    throw new HttpError(401, "wrong_password", "群主密码不正确");
  if (!isDeletable(e)) throw badRequest("只能删除已收齐归档或已取消的活动");
  await deleteEvent(c.env, e);
  await clearDeadline(c.env, e.id);
  const label = `${e.date} ${e.code}${e.title ? ` ${e.title}` : ""}`;
  await sendToOwner(
    c.env,
    message(
      `🗑 活动 ${label} 已从数据库永久删除（报名、账单和付款记录一并删除）。\n\n如果不是你本人操作，请立刻修改群主密码。`,
    ),
  );
  return c.json({ ok: true });
});

/** Closes sign-up right away, e.g. when there are already enough people. */
adminEventRoutes.post("/events/:id/close-now", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open") throw badRequest("只有报名中的活动可以提前截止");
  const closed = await c.env.DB.prepare(
    "UPDATE events SET status = 'closed', deadline_at = ? WHERE id = ? AND status = 'open'",
  )
    .bind(now(), e.id)
    .run();
  if (closed.meta.changes) await audit(c.env, e.id, actorId(c.get("actor")), "close_now", "提前截止报名");
  await syncDeadline(c.env, e.id); // 报名截止 goes out right away
  return c.json({ ok: true });
});

/**
 * Emergency edit of date, times and location. The event code stays the same so links and
 * payment codes already sent out keep working. An open event's deadline moves with the start
 * (never past the end); if it has already passed, sign-up closes. Closed events stay closed.
 */
adminEventRoutes.post("/events/:id/edit", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status === "settled") throw badRequest("这个活动已收齐归档，不能再修改");
  if (e.status === "cancelled") throw badRequest("这个活动已取消");
  const b = await readJson(c.req.raw);
  const date = str(b.date);
  const startTime = str(b.startTime);
  const endTime = str(b.endTime);
  const location = str(b.location).trim();
  const address = (b.address === undefined ? e.address : str(b.address)).trim();
  if (!isDate(date)) throw badRequest("请选择日期");
  if (!isTime(startTime) || !isTime(endTime)) throw badRequest("请填写开始和结束时间");
  checkVenue(location, address);
  const startAt = pacificToUtc(date, startTime);
  let endAt = pacificToUtc(date, endTime);
  if (endAt <= startAt) endAt = new Date(Date.parse(endAt) + 86400_000).toISOString();
  let deadline = e.deadline_at;
  let status = e.status;
  if (e.status === "open") {
    // The deadline moves with the start, keeping its lead time: the usual offset, or whatever
    // 重新开放报名 set (which may run past the start), so a title or venue fix changes nothing.
    // Like reopen, never past the end, or the event would stay open (and unsettleable) after it.
    deadline = new Date(Date.parse(e.deadline_at) + Date.parse(startAt) - Date.parse(e.start_at)).toISOString();
    if (deadline > endAt) deadline = endAt;
    if (deadline <= now()) status = "closed";
  }
  const ts = now();
  // Only over what was read: a close, Finalize or archive landing in between is never undone.
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE events SET date = ?, start_at = ?, end_at = ?, location = ?, address = ?, title = ?, deadline_at = ?, status = ?
       WHERE id = ? AND status = ? AND deadline_at = ?`,
    ).bind(
      date,
      startAt,
      endAt,
      location,
      address,
      b.title === undefined ? e.title : cleanTitle(str(b.title)),
      deadline,
      status,
      e.id,
      e.status,
      e.deadline_at,
    ),
    saveVenue(c.env, location, address, ts),
  ]);
  if (!res?.meta.changes) throw badRequest("这个活动刚刚有了变化，请刷新后再改");
  const after = await getEvent(c.env, e.id);
  const changes = editChanges(e, after);
  if (changes.length) await audit(c.env, e.id, actorId(c.get("actor")), "edit", `修改活动：${changes.join("；")}`);
  await syncDeadline(c.env, e.id);
  return c.json(await detail(c.env, after, c.get("actor").memberId));
});

/** What 修改活动 changed, for the log: each field as 原来 → 现在. */
function editChanges(a: EventRow, b: EventRow): string[] {
  const time = (e: EventRow) => `${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`;
  const fields: [string, string, string][] = [
    ["日期", a.date, b.date],
    ["时间", time(a), time(b)],
    ["场馆", a.location, b.location],
    ["地址", a.address, b.address],
    ["标题", a.title || "（无）", b.title || "（无）"],
  ];
  const out = fields.filter(([, x, y]) => x !== y).map(([k, x, y]) => `${k} ${x} → ${y}`);
  // An open event's deadline moves with the start.
  if (a.deadline_at !== b.deadline_at)
    out.push(`报名截止 ${formatInstantZh(a.deadline_at)} → ${formatInstantZh(b.deadline_at)}`);
  if (a.status !== b.status && b.status === "closed") out.push("新的截止时间已过，报名截止");
  return out;
}

/** Reopens sign-up with a new deadline, which may be as late as the event's end. */
adminEventRoutes.post("/events/:id/reopen", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "closed") throw badRequest("只能重新开放已截止、还没 Finalize 的活动");
  const b = await readJson(c.req.raw);
  const date = str(b.date);
  const time = str(b.time);
  if (!isDate(date) || !isTime(time)) throw badRequest("请填写新的截止时间");
  const deadline = pacificToUtc(date, time);
  if (deadline <= now()) throw badRequest("新的截止时间必须晚于现在");
  if (deadline > e.end_at) throw badRequest("截止时间最晚只能到活动结束");
  const res = await c.env.DB.prepare(
    "UPDATE events SET status = 'open', deadline_at = ? WHERE id = ? AND status = 'closed'",
  )
    .bind(deadline, e.id)
    .run();
  if (!res.meta.changes) throw badRequest("只能重新开放已截止、还没 Finalize 的活动");
  await audit(c.env, e.id, actorId(c.get("actor")), "reopen", `重新开放报名，截止到 ${date} ${time}`);
  await syncDeadline(c.env, e.id);
  return c.json({ ok: true });
});

/**
 * Adds people to the roster: the member themselves (optional) and any number of friends hung
 * under them. Walk-ins who are not members are added as friends of the Owner or another member.
 */
adminEventRoutes.post("/events/:id/roster/add", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const b = await readJson(c.req.raw);
  const m = await requireMember(c.env, str(b.memberId));
  if (m.status !== "active") throw badRequest("只能添加正常状态的成员");
  const includeSelf = b.includeSelf === true;
  const friends = validateFriends(b.friends ?? [], null);
  if (!includeSelf && friends.length === 0) throw badRequest("请选择要添加的人");

  const rows = await c.env.DB.prepare("SELECT friend_index FROM registrations WHERE event_id = ? AND member_id = ?")
    .bind(e.id, m.id)
    .all<{ friend_index: number }>();
  const indexes = rows.results.map((r) => r.friend_index);
  if (includeSelf && indexes.includes(0)) throw badRequest(`${m.username} 已经在名单上了`);
  let next = Math.max(0, ...indexes) + 1;
  const ts = now();
  const insert = (index: number, name: string | null) =>
    c.env.DB.prepare(
      `INSERT INTO registrations (event_id, member_id, friend_index, friend_name, attended, added_by_owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
    ).bind(e.id, m.id, index, name, ts, ts);
  await c.env.DB.batch([
    ...(includeSelf ? [insert(0, null)] : []),
    ...friends.map((f) => insert(next++, f.trim().slice(0, 20) || null)),
  ]);
  const first = next - friends.length;
  const added = [
    ...(includeSelf ? [m.username] : []),
    ...friends.map((f, i) => friendName(m.username, first + i, f.trim().slice(0, 20) || null)),
  ];
  await audit(c.env, e.id, actorId(c.get("actor")), "roster_add", `添加 ${added.join("、")}`);
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

adminEventRoutes.post("/events/:id/roster/:rid/rename", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const b = await readJson(c.req.raw);
  const rid = Number(c.req.param("rid"));
  const was = await rosterLabel(c.env, rid);
  const res = await c.env.DB.prepare(
    "UPDATE registrations SET friend_name = ?, updated_at = ? WHERE id = ? AND event_id = ? AND friend_index > 0",
  )
    .bind(str(b.name).trim().slice(0, 20) || null, now(), rid, e.id)
    .run();
  if (!res.meta.changes) throw badRequest("只能修改朋友的名字");
  const is = await rosterLabel(c.env, rid);
  if (was !== is) await audit(c.env, e.id, actorId(c.get("actor")), "roster_rename", `把 ${was} 改名为 ${is}`);
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

adminEventRoutes.post("/events/:id/roster/:rid/remove", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const rid = Number(c.req.param("rid"));
  await assertCostsShared(c.env, e, (list) => list.filter((r) => r.id !== rid));
  const who = await rosterLabel(c.env, rid);
  const res = await c.env.DB.prepare("DELETE FROM registrations WHERE id = ? AND event_id = ?").bind(rid, e.id).run();
  if (res.meta.changes) await audit(c.env, e.id, actorId(c.get("actor")), "roster_remove", `把 ${who} 移出名单`);
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

adminEventRoutes.get("/settings", async (c) => {
  const s = await getSettings(c.env.DB, ["venmo_username", "venmo_email", "zelle_account"]);
  return c.json({
    friendCap: await friendCap(c.env),
    venmoUsername: s.venmo_username ?? "",
    venmoEmail: s.venmo_email ?? "",
    zelleAccount: s.zelle_account ?? "",
    siteTitle: await siteTitle(c.env),
    theme: await siteTheme(c.env),
    showLeaderboard: (await getSettings(c.env.DB, ["show_leaderboard"])).show_leaderboard !== "0",
    ...(await notifySettings(c.env)),
  });
});

adminEventRoutes.post("/settings", async (c) => {
  const b = await readJson(c.req.raw);
  const writes = [];
  if (b.friendCap !== undefined) {
    const cap = num(b.friendCap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 10) throw badRequest("带朋友上限请填 0–10");
    writes.push(setSetting(c.env.DB, "friend_cap", String(cap)));
  }
  if (b.siteTitle !== undefined) {
    const t = str(b.siteTitle).trim();
    if (!t) throw badRequest("请填写网站标题");
    if ([...t].length > SITE_TITLE_MAX) throw badRequest(`网站标题最多 ${SITE_TITLE_MAX} 个字`);
    writes.push(setSetting(c.env.DB, "site_title", t));
  }
  if (b.showLeaderboard !== undefined)
    writes.push(setSetting(c.env.DB, "show_leaderboard", b.showLeaderboard === false ? "0" : "1"));
  if (b.theme !== undefined) {
    if (!isTheme(b.theme)) throw badRequest("没有这个配色");
    writes.push(setSetting(c.env.DB, "theme", b.theme));
  }
  if (b.reminderEnabled !== undefined)
    writes.push(setSetting(c.env.DB, "reminder_enabled", b.reminderEnabled === false ? "0" : "1"));
  if (b.reminderHours !== undefined) {
    const h = num(b.reminderHours);
    if (!Number.isInteger(h) || h < 1 || h > 72) throw badRequest("截止前提醒请填 1–72 小时");
    writes.push(setSetting(c.env.DB, "reminder_hours", String(h)));
  }
  if (b.dunningHour !== undefined) {
    const h = num(b.dunningHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw badRequest("账单提醒时间请选 0–23 点");
    writes.push(setSetting(c.env.DB, "dunning_hour", String(h)));
  }
  if (b.weeklyDigest !== undefined)
    writes.push(setSetting(c.env.DB, "weekly_digest", b.weeklyDigest === false ? "0" : "1"));
  if (writes.length) await c.env.DB.batch(writes);
  if (b.reminderEnabled !== undefined || b.reminderHours !== undefined) await syncAllDeadlines(c.env);
  return c.json({ ok: true });
});

/**
 * 收款设置: where members' money goes. Changed rarely, so it needs the admin password, and every
 * change is reported to the Owner's Telegram in case it was not them.
 */
adminEventRoutes.post("/settings/payment", async (c) => {
  const b = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(b.password)))) throw new HttpError(401, "wrong_password", "群主密码不正确");
  const { venmo, mail, zelle } = readPaymentInput(b);
  // Never an organizer's account, current or recent: payments into it would be taken as the Owner's.
  // The Owner's own change takes effect at once, as before (no 60-day alias).
  await assertAccountFree(c.env.DB, null, { venmo, mail, zelle });

  const before = await getSettings(c.env.DB, ["venmo_username", "venmo_email", "zelle_account"]);
  await c.env.DB.batch([
    setSetting(c.env.DB, "venmo_username", venmo),
    setSetting(c.env.DB, "venmo_email", mail),
    setSetting(c.env.DB, "zelle_account", zelle),
  ]);
  const changes = [
    ["Venmo", before.venmo_username ? `@${before.venmo_username}` : "", venmo ? `@${venmo}` : ""],
    ["Venmo 通知邮箱", before.venmo_email ?? "", mail],
    ["Zelle", before.zelle_account ?? "", zelle],
  ].filter(([, a, z]) => a !== z);
  if (changes.length) {
    const lines = changes.map(([k, a, z]) => `${k}：${a || "（空）"} → ${z || "（空）"}`).join("\n");
    await sendToOwner(c.env, message(`🔐 收款设置已修改\n${lines}\n\n如果不是你本人操作，请立刻修改群主密码。`));
  }
  return c.json({ ok: true });
});

/**
 * 我的收款设置 (`self`): where the money of the events someone runs goes. The Owner's stay in
 * settings, behind the password (/settings/payment above); this is an organizer's own.
 */
adminEventRoutes.get("/payment-profile", async (c) => {
  const actor = c.get("actor");
  const me = actor.memberId;
  if (actor.role === "owner") {
    const p = await payeeProfile(c.env.DB, me);
    return c.json({
      venmoUsername: p?.venmoUsername ?? "",
      venmoEmail: p?.venmoEmail ?? "",
      zelleAccount: p?.zelleAccount ?? "",
      outstandingBills: me ? await outstandingBills(c.env.DB, me) : 0,
      lastVenmoEmailAt: null,
      gmailConfirm: null,
      gmailConfirmAt: null,
    });
  }
  // The saved row as is (payeeProfile drops one with only an email, which still counts as taken).
  const p = await c.env.DB.prepare(
    `SELECT venmo_username, venmo_email, zelle_account, email_last_at,
       CASE WHEN gmail_confirm_at > ?2 THEN gmail_confirm END AS gmail_confirm,
       CASE WHEN gmail_confirm_at > ?2 THEN gmail_confirm_at END AS gmail_confirm_at
     FROM payment_profiles WHERE member_id = ?1`,
  )
    .bind(me, new Date(Date.now() - GMAIL_CONFIRM_HOURS * 3600_000).toISOString())
    .first<Record<string, string | null>>();
  return c.json({
    venmoUsername: p?.venmo_username ?? "",
    venmoEmail: p?.venmo_email ?? "",
    zelleAccount: p?.zelle_account ?? "",
    // Changing the Venmo account now keeps the old one recognized for a while (the page warns).
    outstandingBills: me ? await outstandingBills(c.env.DB, me) : 0,
    // Their own forwarding: 转发已生效 once a Venmo email for their account arrived, and Gmail's
    // confirmation code for 24 hours (design §6.3).
    lastVenmoEmailAt: p?.email_last_at ?? null,
    gmailConfirm: p?.gmail_confirm ?? null,
    gmailConfirmAt: p?.gmail_confirm_at ?? null,
  });
});

adminEventRoutes.post("/payment-profile", async (c) => {
  const actor = c.get("actor");
  if (actor.role === "owner" || !actor.memberId)
    throw badRequest("群主的收款设置请在「设置 › 收款设置」里修改（需要群主密码）");
  const { changes } = await savePaymentProfile(c.env, actor.memberId, readPaymentInput(await readJson(c.req.raw)));
  if (changes.length) {
    // The Owner hears of it, as of their own, and so does the organizer, in case it wasn't them.
    const lines = changes.map(([k, a, z]) => `${k}：${a || "（空）"} → ${z || "（空）"}`).join("\n");
    await sendToOwner(
      c.env,
      message(`🔐 组织者 ${await payeeName(c.env.DB, actor.memberId)} 的收款设置已修改\n${lines}`),
    );
    await sendToMember(
      c.env,
      actor.memberId,
      message(`🔐 你的收款设置已修改\n${lines}\n\n如果不是你本人操作，请马上告诉群主。`),
    );
  }
  return c.json({ ok: true });
});

// ---- Attendance, settlement and payments ----

adminEventRoutes.post("/events/:id/attendance", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const b = await readJson(c.req.raw);
  const rid = num(b.registrationId);
  const attended = b.attended !== false;
  await assertCostsShared(c.env, e, (list) => list.map((r) => (r.id === rid ? { ...r, attended } : r)));
  const res = await c.env.DB.prepare(
    "UPDATE registrations SET attended = ?, updated_at = ? WHERE id = ? AND event_id = ? AND attended != ?",
  )
    .bind(attended ? 1 : 0, now(), rid, e.id, attended ? 1 : 0)
    .run();
  if (res.meta.changes)
    await audit(
      c.env,
      e.id,
      actorId(c.get("actor")),
      "attendance",
      async () => `把 ${await rosterLabel(c.env, rid)} 标为${attended ? "到场" : "未出席"}`,
    );
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e, c.get("actor").memberId));
});

const MAX_COURT_CENTS = 500_000;
const MAX_SHUTTLE_CENTS = 2_000;

function readInput(b: Record<string, unknown>): SettleInput {
  const court = parseDollars(str(b.courtTotal) || String(b.courtTotal ?? ""));
  const price = parseDollars(str(b.shuttlePrice) || String(b.shuttlePrice ?? ""));
  const count = num(b.shuttleCount);
  if (court === null) throw badRequest("请填写场地总费用（美元）");
  if (!Number.isInteger(count) || count < 0 || count > 500) throw badRequest("请填写用球个数");
  if (price === null) throw badRequest("请填写羽毛球单价（美元）");
  // Sanity limits against a typo (an extra zero, cents typed as dollars) going out on everyone's bill.
  if (court > MAX_COURT_CENTS) throw badRequest(`场地总费用超过 $${dollars(MAX_COURT_CENTS)}，请检查是否多打了一个 0`);
  if (price > MAX_SHUTTLE_CENTS) throw badRequest(`羽毛球单价超过 $${dollars(MAX_SHUTTLE_CENTS)}，请检查是否填错`);
  return { courtTotalCents: court, shuttleCount: count, shuttlePriceCents: price };
}

function assertSettleable(e: EventRow) {
  if (e.status === "open") throw badRequest("报名还没截止，不能结算");
  if (e.status === "settled") throw badRequest("这个活动已收齐归档，不能再修改");
  if (e.status === "cancelled") throw badRequest("这个活动已取消");
}

adminEventRoutes.get("/events/:id/settlement", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  const input = await savedInput(c.env, e.id);
  const s = await lastValues(c.env.DB, await eventManager(c.env.DB, e), ["last_shuttle_price_cents"]);
  const payments = await paymentRows(c.env, e);
  return c.json<SettlementView>({
    inputs: input && {
      courtTotal: dollars(input.courtTotalCents),
      shuttleCount: input.shuttleCount,
      shuttlePrice: dollars(input.shuttlePriceCents),
    },
    defaultShuttlePrice: s.last_shuttle_price_cents ? dollars(Number(s.last_shuttle_price_cents)) : "",
    payments,
    totals: {
      dueCents: payments.reduce((t, p) => t + p.amountDueCents, 0),
      paidCents: payments.reduce((t, p) => t + p.amountPaidCents, 0),
      unpaidCount: payments.filter((p) => p.status !== "paid").length,
    },
    payeeIsMe: (await eventPayee(c.env.DB, e)) === c.get("actor").memberId,
  });
});

adminEventRoutes.post("/events/:id/preview", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertSettleable(e);
  const input = readInput(await readJson(c.req.raw));
  return c.json(settle(await settleRows(c.env, e.id), input));
});

adminEventRoutes.post("/events/:id/finalize", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertSettleable(e);
  const input = readInput(await readJson(c.req.raw));
  if ((await settleRows(c.env, e.id)).length === 0) throw badRequest("名单是空的，不能结算");
  await assertPayeeReady(c.env, e, c.get("actor").memberId);
  const was = await savedInput(c.env, e.id);
  const fees = (i: SettleInput) =>
    `场地 ${money(i.courtTotalCents)}，用球 ${i.shuttleCount} 个 × ${money(i.shuttlePriceCents)}`;
  if (await finalize(c.env, e, input))
    await audit(c.env, e.id, actorId(c.get("actor")), "finalize", `Finalize 发出账单：${fees(input)}`);
  // Saved again with the same fees, or a second click on the first Finalize (no fees saved yet when
  // it read them): nothing changed.
  else if (was && fees(was) !== fees(input))
    await audit(c.env, e.id, actorId(c.get("actor")), "fee_edit", `修改费用：${fees(input)}（原来：${fees(was)}）`);
  // After the entry, so the archive it may cause (every bill already paid) comes after it in the log.
  await checkCollected(c.env, e.id);
  return c.json({ ok: true });
});

async function paymentEvent(env: Env, paymentId: number, allowSettled = false) {
  const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first<{
    id: number;
    event_id: number;
    member_id: string;
    status: string;
    amount_due_cents: number;
    amount_paid_cents: number;
    refunded_cents: number;
  }>();
  if (!p) throw badRequest("找不到这笔应付款");
  const e = await getEvent(env, p.event_id);
  if (e.status !== "finalized" && !(allowSettled && e.status === "settled"))
    throw badRequest("这个活动已收齐归档，不能再修改");
  return { p, e };
}

/** Cash, Zelle or anything else: a manual receipt for whatever is still owed. */
adminEventRoutes.post("/payments/:pid/mark-paid", async (c) => {
  const id = Number(c.req.param("pid"));
  const { p, e } = await paymentEvent(c.env, id);
  const amount = await markPaid(c.env, id);
  if (amount === null) throw badRequest("这笔已经付清了");
  await audit(
    c.env,
    e.id,
    actorId(c.get("actor")),
    "mark_paid",
    async () => `把 ${await billOwner(c.env, p.member_id)} 的账单标记为已付（记一笔 ${money(amount)}）`,
  );
  const settled = await checkCollected(c.env, e.id);
  return c.json({ ok: true, settled });
});

/**
 * Takes back one payment (a mistaken manual mark, or a Venmo payment on the wrong bill). A Venmo
 * payment goes to 待确认 rather than vanishing, so the Owner can put it on the right bill: the
 * 待确认 row it was linked from is reopened, and an auto-matched one gets a new row with its note.
 */
adminEventRoutes.post("/receipts/:rid/remove", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM payment_receipts WHERE id = ?")
    .bind(Number(c.req.param("rid")))
    .first<{
      id: number;
      payment_id: number;
      amount_cents: number;
      method: string;
      venmo_txn_id: string | null;
      payer_name: string | null;
      received_at: string;
      note: string | null;
      inbound_id: number | null;
    }>();
  if (!r) throw badRequest("找不到这笔付款记录");
  const { p, e } = await paymentEvent(c.env, r.payment_id, true);
  // Archived: only an extra Venmo payment may come off (a wrong link, say), so the bill stays paid.
  if (
    e.status === "settled" &&
    !((r.method === "venmo" || r.venmo_txn_id) && p.amount_paid_cents - r.amount_cents >= p.amount_due_cents)
  )
    throw badRequest("这个活动已收齐归档，只能撤销多付的 Venmo 付款");
  // Only while it could be linked back again, so an undo can always be put right.
  if (e.status === "settled" && (e.settled_at ?? "") < linkCutoff())
    throw badRequest(`这个活动归档已超过 ${LINK_ARCHIVED_DAYS} 天，不能再撤销`);
  // The payee's own bill is paid by itself, and every recompute redoes that receipt anyway.
  const payee = await eventPayee(c.env.DB, e);
  if (r.method === "manual" && !r.venmo_txn_id && p.member_id === payee)
    throw badRequest(`${await payeeName(c.env.DB, payee)}本人的账单自动记为已付，不用撤销`);
  // On an archived bill every statement also checks, inside the transaction, that the bill stays
  // paid without this receipt, so two removals at once can't both pass and leave it unpaid.
  const keepsPaid =
    e.status === "settled"
      ? `AND (SELECT amount_paid_cents - amount_due_cents FROM payments WHERE id = ${Number(p.id)}) >= ${Number(r.amount_cents)}`
      : "";
  const back: D1PreparedStatement[] = [];
  // Venmo receipts, and older linked ones saved as 'manual' that still carry their transaction.
  if (r.method === "venmo" || r.venmo_txn_id) {
    back.push(
      // The 待确认 row it came from (older receipts find it by transaction) reopens from any state,
      // unless another receipt still counts it. Each statement checks the receipt still exists, so a
      // second click changes nothing.
      c.env.DB.prepare(
        `UPDATE inbound_payments SET state = 'open', linked_payment_id = NULL, deleted_from = NULL, deleted_at = NULL,
           reason = CASE WHEN COALESCE(reason, '') = '' OR reason LIKE '从账单撤销的 Venmo 付款%' THEN COALESCE(NULLIF(reason, ''), '从账单撤销的 Venmo 付款')
                         ELSE '从账单撤销的 Venmo 付款（原先：' || reason || '）' END
         WHERE id = COALESCE((SELECT id FROM inbound_payments WHERE id = ?1),
                             (SELECT id FROM inbound_payments WHERE venmo_txn_id = ?3))
           AND NOT EXISTS (SELECT 1 FROM payment_receipts o WHERE o.id != ?2
             AND (o.inbound_id = inbound_payments.id OR o.venmo_txn_id = inbound_payments.venmo_txn_id))
           AND EXISTS (SELECT 1 FROM payment_receipts WHERE id = ?2) ${keepsPaid}`,
      ).bind(r.inbound_id, r.id, r.venmo_txn_id),
      // Auto-matched, or its 待确认 row is gone: it gets a row now, so the payment is never lost.
      // Auto-matching only takes money that went into the event's payee's account, so that's whose it is.
      c.env.DB.prepare(
        `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind, reason, payee_id)
         SELECT ?3, ?4, ?5, ?6, ?7, 'unmatched', '从账单撤销的 Venmo 付款', ?8
         WHERE EXISTS (SELECT 1 FROM payment_receipts WHERE id = ?2)
           AND NOT EXISTS (SELECT 1 FROM inbound_payments WHERE id = ?1 OR venmo_txn_id = ?3) ${keepsPaid}`,
      ).bind(r.inbound_id, r.id, r.venmo_txn_id, r.payer_name, r.amount_cents, r.note, r.received_at, payee),
    );
  }
  const res = await c.env.DB.batch([
    ...back,
    c.env.DB.prepare(`DELETE FROM payment_receipts WHERE id = ? ${keepsPaid}`).bind(r.id),
    ...syncPayments(c.env.DB, "id = ?", r.payment_id),
  ]);
  if (keepsPaid && !res[back.length]?.meta.changes) throw badRequest("这个活动已收齐归档，只能撤销多付的 Venmo 付款");
  if (res[back.length]?.meta.changes) {
    const how =
      r.method === "venmo" || r.venmo_txn_id
        ? `Venmo 付款${r.payer_name ? `（${r.payer_name}）` : ""}`
        : r.method === "refund"
          ? "退款记录"
          : "手动记的付款";
    // Only when its 待确认 row really reopened (or was made); another receipt may still count it.
    const where = res.slice(0, back.length).some((x) => x.meta.changes) ? "，钱移回待确认" : "";
    await audit(
      c.env,
      e.id,
      actorId(c.get("actor")),
      "receipt_remove",
      async () =>
        `撤销 ${await billOwner(c.env, p.member_id)} 账单上的一笔${how} ${money(Math.abs(r.amount_cents))}${where}`,
    );
  }
  return c.json({ ok: true });
});

/** The Owner sent the over-payment back. Allowed on archived events too: it changes no bill. */
adminEventRoutes.post("/payments/:pid/refunded", async (c) => {
  const id = Number(c.req.param("pid"));
  const { p, e } = await paymentEvent(c.env, id, true);
  // One refund record for the whole excess, worked out in the same transaction so a second click adds nothing.
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
       SELECT id, amount_due_cents - amount_paid_cents, 'refund', ? FROM payments WHERE id = ? AND amount_paid_cents > amount_due_cents
       RETURNING amount_cents`,
    ).bind(now(), id),
    ...syncPayments(c.env.DB, "id = ?", id),
  ]);
  if ((res?.meta.changes ?? 0) === 0) throw badRequest("这笔没有需要退的钱");
  const refunded = -((res?.results[0] as { amount_cents: number } | undefined)?.amount_cents ?? 0);
  await audit(
    c.env,
    e.id,
    actorId(c.get("actor")),
    "refund",
    async () => `${await billOwner(c.env, p.member_id)} 多付的 ${money(refunded)} 已退款`,
  );
  return c.json({ ok: true });
});

adminEventRoutes.get("/inbound", async (c) => {
  // Without `group`: payments into one's own account, and bills of the events one runs.
  const actor = c.get("actor");
  const only = can(actor.role, "group") ? null : actor.memberId;
  const [open, done, ignored, deleted, payments, refunds] = await Promise.all([
    inboundRows(c.env, "open", only),
    inboundRows(c.env, "done", only),
    inboundRows(c.env, "ignored", only),
    inboundRows(c.env, "deleted", only),
    openPayments(c.env, only),
    refundRows(c.env, only),
  ]);
  return c.json<InboundResponse>({ open, done, ignored, deleted, payments, refunds });
});

/**
 * A 待确认 payment's log entry goes on the event its note's code names, when there is one (a
 * payment with no code has no event, and nothing is recorded).
 */
async function inboundEntry(
  env: Env,
  i: { note: string | null; payer_name: string | null; amount_cents: number | null; payee_id: string | null },
  text: (into: string, what: string) => string,
) {
  const e = (await noteTarget(env, i.note))?.e;
  if (!e) return null;
  const into = await payeeName(env.DB, await inboundPayee(env.DB, i));
  const what = `${i.payer_name ?? "付款人不明"}${i.amount_cents === null ? "" : ` ${money(i.amount_cents)}`}`;
  return { eventId: e.id, detail: text(into, what) };
}

async function openInbound(env: Env, id: number) {
  const i = await env.DB.prepare("SELECT * FROM inbound_payments WHERE id = ?").bind(id).first<{
    id: number;
    state: string;
    amount_cents: number | null;
    venmo_txn_id: string | null;
    payer_name: string | null;
    note: string | null;
    payee_id: string | null;
  }>();
  if (!i) throw badRequest("找不到这笔收款");
  if (i.state !== "open") throw badRequest("这笔收款已经处理过了");
  return i;
}

/** The Owner says this Venmo payment belongs to someone's bill: add it there like any payment. */
adminEventRoutes.post("/inbound/:iid/link", async (c) => {
  const i = await openInbound(c.env, Number(c.req.param("iid")));
  const paymentId = num((await readJson(c.req.raw)).paymentId);
  // Only what the list offers; a paid bill then gets an over-payment, listed for refund.
  const bill = await c.env.DB.prepare(
    `SELECT e.id AS event_id, e.status, e.settled_at, ${payeeSql("e")} AS payee, p.member_id, m.deleted_at,
       ${LINKABLE} AS linkable
     FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id WHERE p.id = ?2`,
  )
    .bind(linkCutoff(), paymentId)
    .first<{
      event_id: number;
      status: string;
      settled_at: string | null;
      payee: string | null;
      member_id: string;
      deleted_at: string | null;
      linkable: number;
    }>();
  if (!bill) throw badRequest("找不到这笔应付款");
  if (!bill.linkable)
    throw badRequest(
      bill.member_id === bill.payee
        ? `${await payeeName(c.env.DB, bill.payee)}本人的账单不用关联`
        : bill.deleted_at
          ? "这个成员已删除，他付清的账单不能再关联"
          : bill.status === "settled" && (bill.settled_at ?? "") < linkCutoff()
            ? `这个活动归档已超过 ${LINK_ARCHIVED_DAYS} 天，不能再关联`
            : bill.status === "cancelled"
              ? "这个活动已取消"
              : bill.status !== "finalized" && bill.status !== "settled"
                ? "这个活动还没结算"
                : "这笔应付款不能关联",
    );
  if (i.amount_cents === null) throw badRequest("这笔收款没有金额，请改用「标记已付」");
  // Only one request can move it out of 待确认, so a double click never adds the money twice; the
  // bill is checked again in the same statement.
  const claimed = await c.env.DB.prepare(
    `UPDATE inbound_payments SET state = 'linked', linked_payment_id = ?2 WHERE id = ?3 AND state = 'open'
       AND EXISTS (SELECT 1 FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id
                   WHERE p.id = ?2 AND ${LINKABLE})`,
  )
    .bind(linkCutoff(), paymentId, i.id)
    .run();
  if (!claimed.meta.changes) throw badRequest("这笔收款已经处理过了");
  await addReceipt(c.env, paymentId, {
    amountCents: i.amount_cents,
    method: "venmo",
    txnId: i.venmo_txn_id,
    payerName: i.payer_name,
    note: i.note,
    inboundId: i.id,
  });
  // Money paid into someone else's account than the event's payee: the two settle it between them.
  const amount = i.amount_cents;
  const elsewhere = async () => {
    const into = await inboundPayee(c.env.DB, i);
    return into !== bill.payee ? `；钱在 ${await payeeName(c.env.DB, into)} 的账户` : "";
  };
  await audit(
    c.env,
    bill.event_id,
    actorId(c.get("actor")),
    "inbound_link",
    async () =>
      `把待确认的 Venmo 收款（${i.payer_name ?? "付款人不明"} ${money(amount)}）关联到 ${await billOwner(c.env, bill.member_id)} 的账单${await elsewhere()}`,
  );
  const settled = await checkCollected(c.env, bill.event_id);
  return c.json({ ok: true, settled });
});

adminEventRoutes.post("/inbound/:iid/ignore", async (c) => {
  const i = await openInbound(c.env, Number(c.req.param("iid")));
  // Only from 待确认, so a 关联 that won the race is never overwritten.
  const res = await c.env.DB.prepare("UPDATE inbound_payments SET state = 'ignored' WHERE id = ? AND state = 'open'")
    .bind(i.id)
    .run();
  if (!res.meta.changes) throw badRequest("这笔收款已经处理过了");
  await record(c.env, actorId(c.get("actor")), "inbound_ignore", () =>
    inboundEntry(c.env, i, (into, what) => `忽略付到 ${into} 账户的 Venmo 收款（${what}）`),
  );
  return c.json({ ok: true });
});

/** 移回待确认: undoes a mistaken 忽略, so the payment can still be linked to a bill. */
adminEventRoutes.post("/inbound/:iid/unignore", async (c) => {
  // Read first, for the log; the update below decides.
  const i = await c.env.DB.prepare("SELECT note, payer_name, amount_cents, payee_id FROM inbound_payments WHERE id = ?")
    .bind(Number(c.req.param("iid")))
    .first<{ note: string | null; payer_name: string | null; amount_cents: number | null; payee_id: string | null }>();
  const res = await c.env.DB.prepare(
    `UPDATE inbound_payments SET state = 'open', linked_payment_id = NULL,
       reason = CASE WHEN COALESCE(reason, '') = '' THEN '忽略后移回'
                     WHEN reason LIKE '%忽略后移回%' THEN reason ELSE reason || '（忽略后移回）' END
     WHERE id = ?1 AND state = 'ignored'
       -- Never one whose money is already on a bill, so it can't be counted twice.
       AND NOT EXISTS (SELECT 1 FROM payment_receipts o
         WHERE o.inbound_id = ?1 OR o.venmo_txn_id = inbound_payments.venmo_txn_id)`,
  )
    .bind(Number(c.req.param("iid")))
    .run();
  if (!res.meta.changes) {
    const row = await c.env.DB.prepare("SELECT state FROM inbound_payments WHERE id = ?")
      .bind(Number(c.req.param("iid")))
      .first<{ state: string }>();
    throw badRequest(
      row?.state === "ignored"
        ? "这笔付款已经记在一张账单上了，不能再移回待确认；需要改的话请在那张账单里撤销"
        : "只能把已忽略的收款移回待确认",
    );
  }
  // Undoes a recorded 忽略, so it is recorded too.
  if (i)
    await record(c.env, actorId(c.get("actor")), "inbound_unignore", () =>
      inboundEntry(c.env, i, (into, what) => `把付到 ${into} 账户的 Venmo 收款（${what}）从已忽略移回待确认`),
    );
  return c.json({ ok: true });
});

// ---- 已删除: Venmo payments in the trash, kept 30 days ----

/** Moves a 待确认 or ignored payment to 已删除. A linked one belongs to a bill: undo it there instead. */
adminEventRoutes.post("/inbound/:iid/delete", async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE inbound_payments SET deleted_from = state, state = 'deleted', deleted_at = ?
     WHERE id = ? AND state IN ('open', 'ignored')`,
  )
    .bind(now(), Number(c.req.param("iid")))
    .run();
  if (!res.meta.changes) throw badRequest("只能删除待确认或已忽略的收款；已关联的请在账单里撤销");
  return c.json({ ok: true });
});

adminEventRoutes.post("/inbound/:iid/restore", async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE inbound_payments SET state = COALESCE(deleted_from, 'open'), deleted_from = NULL, deleted_at = NULL
     WHERE id = ? AND state = 'deleted'`,
  )
    .bind(Number(c.req.param("iid")))
    .run();
  if (!res.meta.changes) throw badRequest("这笔收款不在「已删除」里");
  return c.json({ ok: true });
});

/** 永久删除 one payment from 已删除; the page asks for confirmation. */
adminEventRoutes.post("/inbound/:iid/purge", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM inbound_payments WHERE id = ? AND state = 'deleted'")
    .bind(Number(c.req.param("iid")))
    .run();
  if (!res.meta.changes) throw badRequest("这笔收款不在「已删除」里");
  return c.json({ ok: true });
});

/** 清空 已删除: needs the admin password as well as the page's confirmation. */
adminEventRoutes.post("/inbound/trash/clear", async (c) => {
  if (!(await checkPassword(c.env, str((await readJson(c.req.raw)).password))))
    throw new HttpError(401, "wrong_password", "群主密码不正确");
  const res = await c.env.DB.prepare("DELETE FROM inbound_payments WHERE state = 'deleted'").run();
  return c.json({ ok: true, removed: res.meta.changes });
});

// ---- Telegram: each person's own chat (the Owner's in settings, an organizer's in telegram_bindings) ----

/** Whose chat the caller manages: null for the Owner. */
function chatOwner(actor: Actor): ChatOwner {
  if (actor.role === "owner") return null;
  if (!actor.memberId) throw new HttpError(403, "forbidden", "没有权限做这个操作");
  return actor.memberId;
}

adminEventRoutes.get("/telegram", async (c) => c.json(await telegramStatus(c.env, chatOwner(c.get("actor")))));

/** Returns the t.me link that binds the caller's chat; tapping Start there completes it. */
adminEventRoutes.post("/telegram/connect", async (c) =>
  c.json({ link: await startBinding(c.env, chatOwner(c.get("actor"))) }),
);

adminEventRoutes.post("/telegram/test", async (c) => {
  const who = chatOwner(c.get("actor"));
  const text = message("🏸 测试消息：通知工作正常。", "这一段是可以复制到微信的文字。");
  const ok = who === null ? await sendToOwner(c.env, text) : await sendToMember(c.env, who, text);
  if (!ok) throw badRequest("发送失败：请先连接 Telegram，或检查机器人是否被停用");
  return c.json({ ok: true });
});

adminEventRoutes.post("/telegram/disconnect", async (c) => {
  await disconnect(c.env, chatOwner(c.get("actor")));
  return c.json({ ok: true });
});

/** 停止 / 恢复账单提醒: the event stays unarchived and its unpaid bills stay. */
adminEventRoutes.post("/events/:id/dunning", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "finalized") throw badRequest("只有已结算、还没收齐的活动才能停止账单提醒");
  const stop = (await readJson(c.req.raw)).stop === true;
  const res = await c.env.DB.prepare("UPDATE events SET dunning_stopped = ? WHERE id = ? AND dunning_stopped != ?")
    .bind(stop ? 1 : 0, e.id, stop ? 1 : 0)
    .run();
  if (res.meta.changes)
    await audit(
      c.env,
      e.id,
      actorId(c.get("actor")),
      stop ? "dunning_stop" : "dunning_resume",
      stop ? "停止账单提醒" : "恢复账单提醒",
    );
  return c.json({ ok: true, dunningStopped: stop });
});

// ---- Export ----

adminEventRoutes.get("/export/:file", async (c) => {
  const m = /^([a-z]+)\.csv$/.exec(c.req.param("file"));
  if (!m || !isTable(m[1]!)) throw badRequest("没有这个表");
  const t = await TABLES[m[1]!].build(c.env);
  const name = `${t.title}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(toCsv(t), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${m[1]}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});

adminEventRoutes.get("/sheets", async (c) =>
  c.json({ ...(await sheetsStatus(c.env)), ...(await currentScript(c.env)) }),
);

/** 开启同步 / 重新生成密钥: either way a fresh key, so a leaked script stops working. */
adminEventRoutes.post("/sheets/enable", async (c) => c.json({ script: await rotateExportKey(c.env) }));

adminEventRoutes.post("/sheets/disable", async (c) => {
  await disableExport(c.env);
  return c.json({ ok: true });
});

// ---- Address suggestions for the venue form ----

adminEventRoutes.get("/places", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  if (q.length < 3) return c.json({ suggestions: [] });
  return c.json({ suggestions: await suggestAddresses(c.env, q, (c.req.query("s") ?? "").slice(0, 64)) });
});

adminEventRoutes.get("/places/:id", async (c) =>
  c.json({ address: await resolveAddress(c.env, c.req.param("id"), (c.req.query("s") ?? "").slice(0, 64)) }),
);

/** 转发状态: when the last Venmo/Gmail email arrived and what happened to it. */
adminEventRoutes.get("/email-status", async (c) => c.json(await emailStatus(c.env)));
