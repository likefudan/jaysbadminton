import { Hono } from "hono";
import { dollars, parseDollars, settle, type SettleInput } from "../../shared/settle";
import type { EventDefaults, SettlementView } from "../../shared/types";
import { checkCollected, finalize, paymentRows, recomputeIfFinalized, savedInput, settleRows } from "../billing";
import { isDate, isTime, pacificToUtc } from "../../shared/time";
import { getSettings, now, setSetting } from "../db";
import type { Env } from "../env";
import {
  assertRosterEditable,
  closeExpired,
  createEvent,
  detail,
  friendCap,
  getEvent,
  summaries,
  validateFriends,
  type EventRow,
} from "../events";
import { badRequest, readJson, str } from "../http";
import { requireMember } from "../members";

/** Mounted under /api/admin/:token after the admin auth middleware. */
export const adminEventRoutes = new Hono<{ Bindings: Env }>();

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

adminEventRoutes.get("/events", async (c) => {
  await closeExpired(c.env);
  const current = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at",
  ).all<EventRow>();
  const past = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('settled', 'cancelled') ORDER BY start_at DESC LIMIT 30",
  ).all<EventRow>();
  return c.json({ current: await summaries(c.env, current.results), past: await summaries(c.env, past.results) });
});

adminEventRoutes.get("/events/defaults", async (c) => {
  const s = await getSettings(c.env.DB, ["last_start_time", "last_end_time", "last_location", "last_deadline_offset_min"]);
  const offset = Number(s.last_deadline_offset_min ?? 1440);
  const { results } = await c.env.DB.prepare("SELECT name FROM locations ORDER BY last_used_at DESC LIMIT 10").all<{ name: string }>();
  return c.json<EventDefaults>({
    startTime: s.last_start_time ?? "19:00",
    endTime: s.last_end_time ?? "21:00",
    location: s.last_location ?? "",
    deadlineDays: Math.floor(offset / 1440),
    deadlineHours: Math.floor((offset % 1440) / 60),
    locations: results.map((r) => r.name),
    friendCap: await friendCap(c.env),
  });
});

adminEventRoutes.post("/events", async (c) => {
  const b = await readJson(c.req.raw);
  const e = await createEvent(c.env, {
    date: str(b.date),
    startTime: str(b.startTime),
    endTime: str(b.endTime),
    location: str(b.location),
    deadlineDays: num(b.deadlineDays),
    deadlineHours: num(b.deadlineHours),
  });
  return c.json(await detail(c.env, e));
});

adminEventRoutes.get("/events/:id", async (c) => {
  await closeExpired(c.env);
  return c.json(await detail(c.env, await getEvent(c.env, Number(c.req.param("id")))));
});

adminEventRoutes.post("/events/:id/cancel", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open" && e.status !== "closed") throw badRequest("只能在 Finalize 之前取消活动");
  await c.env.DB.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e.id).run();
  return c.json({ ok: true });
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
  await c.env.DB.prepare("DELETE FROM registrations WHERE id = ? AND event_id = ?").bind(Number(c.req.param("rid")), e.id).run();
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e));
});

adminEventRoutes.get("/settings", async (c) => {
  const s = await getSettings(c.env.DB, ["venmo_username", "zelle_account"]);
  return c.json({ friendCap: await friendCap(c.env), venmoUsername: s.venmo_username ?? "", zelleAccount: s.zelle_account ?? "" });
});

adminEventRoutes.post("/settings", async (c) => {
  const b = await readJson(c.req.raw);
  const writes = [];
  if (b.friendCap !== undefined) {
    const cap = num(b.friendCap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 10) throw badRequest("带朋友上限请填 0–10");
    writes.push(setSetting(c.env.DB, "friend_cap", String(cap)));
  }
  if (b.venmoUsername !== undefined) {
    const v = str(b.venmoUsername).trim().replace(/^@/, "");
    if (v && !/^[A-Za-z0-9_-]{2,30}$/.test(v)) throw badRequest("Venmo 用户名格式不对（不用加 @）");
    writes.push(setSetting(c.env.DB, "venmo_username", v));
  }
  if (b.zelleAccount !== undefined) writes.push(setSetting(c.env.DB, "zelle_account", str(b.zelleAccount).trim().slice(0, 60)));
  if (writes.length) await c.env.DB.batch(writes);
  return c.json({ ok: true });
});

// ---- Attendance, settlement and payments ----

adminEventRoutes.post("/events/:id/attendance", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  assertRosterEditable(e);
  const b = await readJson(c.req.raw);
  await c.env.DB.prepare("UPDATE registrations SET attended = ?, updated_at = ? WHERE id = ? AND event_id = ?")
    .bind(b.attended === false ? 0 : 1, now(), num(b.registrationId), e.id)
    .run();
  await recomputeIfFinalized(c.env, e);
  return c.json(await detail(c.env, e));
});

function readInput(b: Record<string, unknown>): SettleInput {
  const court = parseDollars(str(b.courtTotal) || String(b.courtTotal ?? ""));
  const price = parseDollars(str(b.shuttlePrice) || String(b.shuttlePrice ?? ""));
  const count = num(b.shuttleCount);
  if (court === null) throw badRequest("请填写场地总费用（美元）");
  if (!Number.isInteger(count) || count < 0 || count > 500) throw badRequest("请填写用球个数");
  if (price === null) throw badRequest("请填写羽毛球单价（美元）");
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
      paidCents: payments.reduce((t, p) => t + (p.status === "paid" ? (p.amountPaidCents ?? 0) : 0), 0),
      unpaidCount: payments.filter((p) => p.status !== "paid").length,
    },
  });
});

adminEventRoutes.post("/events/:id/preview", async (c) => {
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

async function paymentEvent(env: Env, paymentId: number) {
  const p = await env.DB.prepare("SELECT event_id, status, amount_due_cents FROM payments WHERE id = ?")
    .bind(paymentId)
    .first<{ event_id: number; status: string; amount_due_cents: number }>();
  if (!p) throw badRequest("找不到这笔应付款");
  const e = await getEvent(env, p.event_id);
  if (e.status !== "finalized") throw badRequest("这个活动已收齐归档，不能再修改");
  return { p, e };
}

adminEventRoutes.post("/payments/:pid/mark-paid", async (c) => {
  const id = Number(c.req.param("pid"));
  const { p, e } = await paymentEvent(c.env, id);
  await c.env.DB.prepare(
    "UPDATE payments SET status = 'paid', method = 'manual', amount_paid_cents = COALESCE(amount_paid_cents, ?), paid_at = ? WHERE id = ?",
  )
    .bind(p.amount_due_cents, now(), id)
    .run();
  const settled = await checkCollected(c.env, e.id);
  return c.json({ ok: true, settled });
});

adminEventRoutes.post("/payments/:pid/unmark", async (c) => {
  const id = Number(c.req.param("pid"));
  await paymentEvent(c.env, id);
  await c.env.DB.prepare(
    "UPDATE payments SET status = 'unpaid', method = NULL, amount_paid_cents = NULL, paid_at = NULL, venmo_txn_id = NULL WHERE id = ?",
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});
