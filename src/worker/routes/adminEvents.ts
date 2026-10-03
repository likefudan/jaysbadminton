import { Hono } from "hono";
import { dollars, parseDollars, settle, type SettleInput } from "../../shared/settle";
import type { EventDefaults, InboundResponse, SettlementView } from "../../shared/types";
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
import { isDate, isTime, pacificToUtc } from "../../shared/time";
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
import { SITE_TITLE_MAX, siteTheme, siteTitle } from "../site";
import { isTheme } from "../../shared/themes";
import { requireMember } from "../members";
import {
  LINKABLE,
  LINK_ARCHIVED_DAYS,
  emailStatus,
  inboundRows,
  linkCutoff,
  openPayments,
  refundRows,
} from "../inbound";
import { message, notifySettings } from "../notify";
import { resolveAddress, suggestAddresses } from "../places";
import { TABLES, isTable, toCsv } from "../export";
import { currentScript, disableExport, rotateExportKey, sheetsStatus } from "../sheets";
import { disconnect, sendToOwner, startBinding, telegramStatus } from "../telegram";

/** Mounted under /api/admin/:token after the admin auth middleware. */
export const adminEventRoutes = new Hono<{ Bindings: Env }>();

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** 已结束 shows this many at first; 显示更早的活动 asks for more (?past=60, 90, …). */
const PAST_PAGE = 30;

adminEventRoutes.get("/events", async (c) => {
  const want = Math.floor(Number(c.req.query("past") ?? PAST_PAGE));
  const limit = Number.isFinite(want) ? Math.min(Math.max(want, PAST_PAGE), 2000) : PAST_PAGE;
  const current = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at",
  ).all<EventRow>();
  // One more than shown, to know whether there are older ones.
  const past = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('settled', 'cancelled') ORDER BY start_at DESC LIMIT ?",
  )
    .bind(limit + 1)
    .all<EventRow>();
  return c.json({
    current: await summaries(c.env, current.results),
    past: await summaries(c.env, past.results.slice(0, limit)),
    morePast: past.results.length > limit,
  });
});

adminEventRoutes.get("/events/defaults", async (c) => {
  const s = await getSettings(c.env.DB, [
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
    c.env.DB.prepare("DELETE FROM settings WHERE key = 'last_location' AND value = ?").bind(name),
  ]);
  return c.json({ ok: true });
});

adminEventRoutes.post("/events", async (c) => {
  const b = await readJson(c.req.raw);
  const e = await createEvent(c.env, {
    date: str(b.date),
    startTime: str(b.startTime),
    endTime: str(b.endTime),
    location: str(b.location),
    address: str(b.address),
    title: str(b.title),
    deadlineDays: num(b.deadlineDays),
    deadlineHours: num(b.deadlineHours),
  });
  // "我自己也报名": the Owner signs up as a normal player (ticked by default in the form).
  if (b.joinSelf === true) {
    const owner = await c.env.DB.prepare("SELECT id FROM members WHERE is_owner = 1 AND status = 'active'").first<{
      id: string;
    }>();
    if (owner) await setSignup(c.env, e.id, owner.id, [], false);
  }
  return c.json(await detail(c.env, e));
});

/**
 * 我的报名: the Owner signs themselves up (with friends) from the admin page, which is their only
 * link. Allowed until Finalize, like any roster edit before the bills exist; no friend cap.
 */
async function ownerSignupEvent(env: Env, id: string) {
  await closeExpired(env);
  const e = await getEvent(env, Number(id));
  if (e.status !== "open" && e.status !== "closed")
    throw badRequest("已经结算，不能再改自己的报名；需要调整请直接改名单");
  const owner = await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1 AND status = 'active'").first<{
    id: string;
  }>();
  if (!owner) throw badRequest("找不到管理员本人的成员记录");
  return { e, ownerId: owner.id };
}

adminEventRoutes.post("/events/:id/self-signup", async (c) => {
  const { e, ownerId } = await ownerSignupEvent(c.env, c.req.param("id"));
  const body = await readJson(c.req.raw);
  // No cap for the Owner, but friends already on the list (some may be added from 添加人员) may stay.
  const keep = await friendCount(c.env, e.id, ownerId);
  await setSignup(c.env, e.id, ownerId, validateFriends(body.friends ?? [], null, keep), false);
  return c.json(await detail(c.env, e));
});

adminEventRoutes.post("/events/:id/self-cancel", async (c) => {
  const { e, ownerId } = await ownerSignupEvent(c.env, c.req.param("id"));
  await removeSignup(c.env, e.id, ownerId);
  return c.json(await detail(c.env, e));
});

adminEventRoutes.get("/events/:id", async (c) => {
  return c.json(await detail(c.env, await getEvent(c.env, Number(c.req.param("id")))));
});

adminEventRoutes.post("/events/:id/cancel", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open" && e.status !== "closed") throw badRequest("只能在 Finalize 之前取消活动");
  await c.env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e.id).run();
  await syncDeadline(c.env, e.id);
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
    throw new HttpError(401, "wrong_password", "管理密码不正确");
  if (!isDeletable(e)) throw badRequest("只能删除已收齐归档或已取消的活动");
  await deleteEvent(c.env, e);
  await clearDeadline(c.env, e.id);
  const label = `${e.date} ${e.code}${e.title ? ` ${e.title}` : ""}`;
  await sendToOwner(
    c.env,
    message(
      `🗑 活动 ${label} 已从数据库永久删除（报名、账单和付款记录一并删除）。\n\n如果不是你本人操作，请立刻修改管理密码。`,
    ),
  );
  return c.json({ ok: true });
});

/** Closes sign-up right away, e.g. when there are already enough people. */
adminEventRoutes.post("/events/:id/close-now", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open") throw badRequest("只有报名中的活动可以提前截止");
  await c.env.DB.prepare("UPDATE events SET status = 'closed', deadline_at = ? WHERE id = ? AND status = 'open'")
    .bind(now(), e.id)
    .run();
  await syncDeadline(c.env, e.id); // 报名截止 goes out right away
  return c.json({ ok: true });
});

/**
 * Emergency edit of date, times and location. The event code stays the same so links and
 * payment codes already sent out keep working. An open event keeps its deadline offset; if the
 * new deadline has already passed, sign-up closes. Closed events stay closed.
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
    deadline = new Date(Date.parse(startAt) - e.deadline_offset_min * 60_000).toISOString();
    if (deadline <= now()) status = "closed";
  }
  const ts = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE events SET date = ?, start_at = ?, end_at = ?, location = ?, address = ?, title = ?, deadline_at = ?, status = ? WHERE id = ?",
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
    ),
    saveVenue(c.env, location, address, ts),
  ]);
  await syncDeadline(c.env, e.id);
  return c.json(await detail(c.env, await getEvent(c.env, e.id)));
});

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
  await c.env.DB.prepare("UPDATE events SET status = 'open', deadline_at = ? WHERE id = ?").bind(deadline, e.id).run();
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
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e));
});

adminEventRoutes.post("/events/:id/roster/:rid/rename", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const b = await readJson(c.req.raw);
  const res = await c.env.DB.prepare(
    "UPDATE registrations SET friend_name = ?, updated_at = ? WHERE id = ? AND event_id = ? AND friend_index > 0",
  )
    .bind(str(b.name).trim().slice(0, 20) || null, now(), Number(c.req.param("rid")), e.id)
    .run();
  if (!res.meta.changes) throw badRequest("只能修改朋友的名字");
  return c.json(await detail(c.env, e));
});

adminEventRoutes.post("/events/:id/roster/:rid/remove", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const rid = Number(c.req.param("rid"));
  await assertCostsShared(c.env, e, (list) => list.filter((r) => r.id !== rid));
  await c.env.DB.prepare("DELETE FROM registrations WHERE id = ? AND event_id = ?").bind(rid, e.id).run();
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e));
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
  if (!(await checkPassword(c.env, str(b.password)))) throw new HttpError(401, "wrong_password", "管理密码不正确");
  const venmo = str(b.venmoUsername).trim().replace(/^@/, "");
  if (venmo && !/^[A-Za-z0-9_-]{2,30}$/.test(venmo)) throw badRequest("Venmo 用户名格式不对（不用加 @）");
  // Receipts are only trusted when addressed to this email (the signed To header), so it comes with the username.
  const mail = str(b.venmoEmail).trim().toLowerCase();
  if (venmo && !mail) throw badRequest("请填写 Venmo 通知邮箱（Venmo 账户里登记的邮箱）");
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw badRequest("Venmo 通知邮箱格式不对");
  const zelle = str(b.zelleAccount).trim().slice(0, 60);

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
    await sendToOwner(c.env, message(`🔐 收款设置已修改\n${lines}\n\n如果不是你本人操作，请立刻修改管理密码。`));
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
  await c.env.DB.prepare("UPDATE registrations SET attended = ?, updated_at = ? WHERE id = ? AND event_id = ?")
    .bind(attended ? 1 : 0, now(), rid, e.id)
    .run();
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e));
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
  const s = await getSettings(c.env.DB, ["last_shuttle_price_cents"]);
  const payments = await paymentRows(c.env, e.id);
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
  await finalize(c.env, e, input);
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

const isOwner = async (env: Env, memberId: string) =>
  !!(await env.DB.prepare("SELECT 1 FROM members WHERE id = ? AND is_owner = 1").bind(memberId).first());

/** Cash, Zelle or anything else: a manual receipt for whatever is still owed. */
adminEventRoutes.post("/payments/:pid/mark-paid", async (c) => {
  const id = Number(c.req.param("pid"));
  const { e } = await paymentEvent(c.env, id);
  if (!(await markPaid(c.env, id))) throw badRequest("这笔已经付清了");
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
  // The Owner's own bill is paid by itself, and every recompute redoes that receipt anyway.
  if (r.method === "manual" && !r.venmo_txn_id && (await isOwner(c.env, p.member_id)))
    throw badRequest("管理员本人的账单自动记为已付，不用撤销");
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
      c.env.DB.prepare(
        `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind, reason)
         SELECT ?3, ?4, ?5, ?6, ?7, 'unmatched', '从账单撤销的 Venmo 付款'
         WHERE EXISTS (SELECT 1 FROM payment_receipts WHERE id = ?2)
           AND NOT EXISTS (SELECT 1 FROM inbound_payments WHERE id = ?1 OR venmo_txn_id = ?3) ${keepsPaid}`,
      ).bind(r.inbound_id, r.id, r.venmo_txn_id, r.payer_name, r.amount_cents, r.note, r.received_at),
    );
  }
  const res = await c.env.DB.batch([
    ...back,
    c.env.DB.prepare(`DELETE FROM payment_receipts WHERE id = ? ${keepsPaid}`).bind(r.id),
    ...syncPayments(c.env.DB, "id = ?", r.payment_id),
  ]);
  if (keepsPaid && !res[back.length]?.meta.changes) throw badRequest("这个活动已收齐归档，只能撤销多付的 Venmo 付款");
  return c.json({ ok: true });
});

/** The Owner sent the over-payment back. Allowed on archived events too: it changes no bill. */
adminEventRoutes.post("/payments/:pid/refunded", async (c) => {
  const id = Number(c.req.param("pid"));
  // One refund record for the whole excess, worked out in the same transaction so a second click adds nothing.
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
       SELECT id, amount_due_cents - amount_paid_cents, 'refund', ? FROM payments WHERE id = ? AND amount_paid_cents > amount_due_cents`,
    ).bind(now(), id),
    ...syncPayments(c.env.DB, "id = ?", id),
  ]);
  if ((res?.meta.changes ?? 0) === 0) throw badRequest("这笔没有需要退的钱");
  return c.json({ ok: true });
});

adminEventRoutes.get("/inbound", async (c) =>
  c.json<InboundResponse>({
    open: await inboundRows(c.env, "open"),
    done: await inboundRows(c.env, "done"),
    deleted: await inboundRows(c.env, "deleted"),
    payments: await openPayments(c.env),
    refunds: await refundRows(c.env),
  }),
);

async function openInbound(env: Env, id: number) {
  const i = await env.DB.prepare("SELECT * FROM inbound_payments WHERE id = ?").bind(id).first<{
    id: number;
    state: string;
    amount_cents: number | null;
    venmo_txn_id: string | null;
    payer_name: string | null;
    note: string | null;
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
    `SELECT e.id AS event_id, e.status, m.is_owner, m.deleted_at, ${LINKABLE} AS linkable
     FROM payments p JOIN members m ON m.id = p.member_id JOIN events e ON e.id = p.event_id WHERE p.id = ?2`,
  )
    .bind(linkCutoff(), paymentId)
    .first<{ event_id: number; status: string; is_owner: number; deleted_at: string | null; linkable: number }>();
  if (!bill) throw badRequest("找不到这笔应付款");
  if (!bill.linkable)
    throw badRequest(
      bill.is_owner
        ? "管理员本人的账单不用关联"
        : bill.status === "settled"
          ? `这个活动归档已超过 ${LINK_ARCHIVED_DAYS} 天，不能再关联`
          : bill.status !== "finalized"
            ? "这个活动还没结算"
            : bill.deleted_at
              ? "这个成员已删除，他付清的账单不能再关联"
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
  const settled = await checkCollected(c.env, bill.event_id);
  return c.json({ ok: true, settled });
});

adminEventRoutes.post("/inbound/:iid/ignore", async (c) => {
  const i = await openInbound(c.env, Number(c.req.param("iid")));
  await c.env.DB.prepare("UPDATE inbound_payments SET state = 'ignored' WHERE id = ?").bind(i.id).run();
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
    throw new HttpError(401, "wrong_password", "管理密码不正确");
  const res = await c.env.DB.prepare("DELETE FROM inbound_payments WHERE state = 'deleted'").run();
  return c.json({ ok: true, removed: res.meta.changes });
});

// ---- Telegram ----

adminEventRoutes.get("/telegram", async (c) => c.json(await telegramStatus(c.env)));

/** Returns the t.me link that binds the Owner's chat; tapping Start there completes it. */
adminEventRoutes.post("/telegram/connect", async (c) => c.json({ link: await startBinding(c.env) }));

adminEventRoutes.post("/telegram/test", async (c) => {
  const ok = await sendToOwner(c.env, message("🏸 测试消息：通知工作正常。", "这一段是可以复制到微信的文字。"));
  if (!ok) throw badRequest("发送失败：请先连接 Telegram，或检查机器人是否被停用");
  return c.json({ ok: true });
});

adminEventRoutes.post("/telegram/disconnect", async (c) => {
  await disconnect(c.env);
  return c.json({ ok: true });
});

/** 停止 / 恢复账单提醒: the event stays unarchived and its unpaid bills stay. */
adminEventRoutes.post("/events/:id/dunning", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "finalized") throw badRequest("只有已结算、还没收齐的活动才能停止账单提醒");
  const stop = (await readJson(c.req.raw)).stop === true;
  await c.env.DB.prepare("UPDATE events SET dunning_stopped = ? WHERE id = ?")
    .bind(stop ? 1 : 0, e.id)
    .run();
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
