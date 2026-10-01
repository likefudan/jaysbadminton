import { Hono } from "hono";
import { dollars, parseDollars, settle, type SettleInput } from "../../shared/settle";
import type { EventDefaults, InboundResponse, SettlementView } from "../../shared/types";
import { addReceipt, checkCollected, finalize, paymentRows, recomputeIfFinalized, savedInput, settleRows, syncPayments } from "../billing";
import { isDate, isTime, pacificToUtc } from "../../shared/time";
import { getSettings, now, setSetting } from "../db";
import type { Env } from "../env";
import {
  assertRosterEditable,
  closeExpired,
  createEvent,
  detail,
  friendCap,
  checkVenue,
  getEvent,
  saveVenue,
  setSignup,
  summaries,
  validateFriends,
  type EventRow,
} from "../events";
import { badRequest, readJson, str } from "../http";
import { SITE_TITLE_MAX, siteTheme, siteTitle } from "../site";
import { isTheme } from "../../shared/themes";
import { requireMember } from "../members";
import { inboundRows, openPayments, refundRows } from "../inbound";
import { message, notifySettings } from "../notify";
import { TABLES, isTable, toCsv } from "../export";
import { currentScript, disableExport, rotateExportKey, sheetsStatus } from "../sheets";
import { disconnect, sendToOwner, startBinding, telegramStatus } from "../telegram";

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
  const { results } = await c.env.DB.prepare("SELECT name, address FROM locations ORDER BY last_used_at DESC LIMIT 10").all<{
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

adminEventRoutes.post("/events", async (c) => {
  const b = await readJson(c.req.raw);
  const e = await createEvent(c.env, {
    date: str(b.date),
    startTime: str(b.startTime),
    endTime: str(b.endTime),
    location: str(b.location),
    address: str(b.address),
    deadlineDays: num(b.deadlineDays),
    deadlineHours: num(b.deadlineHours),
  });
  // "我自己也报名": the Owner signs up as a normal player (ticked by default in the form).
  if (b.joinSelf === true) {
    const owner = await c.env.DB.prepare("SELECT id FROM members WHERE is_owner = 1 AND status = 'active'").first<{ id: string }>();
    if (owner) await setSignup(c.env, e.id, owner.id, [], false);
  }
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

/** Closes sign-up right away, e.g. when there are already enough people. */
adminEventRoutes.post("/events/:id/close-now", async (c) => {
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "open") throw badRequest("只有报名中的活动可以提前截止");
  await c.env.DB.prepare("UPDATE events SET status = 'closed', deadline_at = ? WHERE id = ? AND status = 'open'")
    .bind(now(), e.id)
    .run();
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
      "UPDATE events SET date = ?, start_at = ?, end_at = ?, location = ?, address = ?, deadline_at = ?, status = ? WHERE id = ?",
    ).bind(date, startAt, endAt, location, address, deadline, status, e.id),
    saveVenue(c.env, location, address, ts),
  ]);
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
  const s = await getSettings(c.env.DB, ["venmo_username", "venmo_email", "zelle_account"]);
  return c.json({
    friendCap: await friendCap(c.env),
    venmoUsername: s.venmo_username ?? "",
    venmoEmail: s.venmo_email ?? "",
    zelleAccount: s.zelle_account ?? "",
    siteTitle: await siteTitle(c.env),
    theme: await siteTheme(c.env),
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
  if (b.venmoUsername !== undefined) {
    const v = str(b.venmoUsername).trim().replace(/^@/, "");
    if (v && !/^[A-Za-z0-9_-]{2,30}$/.test(v)) throw badRequest("Venmo 用户名格式不对（不用加 @）");
    // Receipts are only trusted when addressed to this email (the signed To header), so it comes with the username.
    const mail = str(b.venmoEmail).trim().toLowerCase();
    if (v && !mail) throw badRequest("请填写 Venmo 通知邮箱（Venmo 账户里登记的邮箱）");
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw badRequest("Venmo 通知邮箱格式不对");
    writes.push(setSetting(c.env.DB, "venmo_username", v), setSetting(c.env.DB, "venmo_email", mail));
  }
  if (b.siteTitle !== undefined) {
    const t = str(b.siteTitle).trim();
    if (!t) throw badRequest("请填写网站标题");
    if ([...t].length > SITE_TITLE_MAX) throw badRequest(`网站标题最多 ${SITE_TITLE_MAX} 个字`);
    writes.push(setSetting(c.env.DB, "site_title", t));
  }
  if (b.theme !== undefined) {
    if (!isTheme(b.theme)) throw badRequest("没有这个配色");
    writes.push(setSetting(c.env.DB, "theme", b.theme));
  }
  if (b.reminderEnabled !== undefined) writes.push(setSetting(c.env.DB, "reminder_enabled", b.reminderEnabled === false ? "0" : "1"));
  if (b.reminderHours !== undefined) {
    const h = num(b.reminderHours);
    if (!Number.isInteger(h) || h < 1 || h > 72) throw badRequest("截止前提醒请填 1–72 小时");
    writes.push(setSetting(c.env.DB, "reminder_hours", String(h)));
  }
  if (b.dunningHour !== undefined) {
    const h = num(b.dunningHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw badRequest("催款时间请选 0–23 点");
    writes.push(setSetting(c.env.DB, "dunning_hour", String(h)));
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
      paidCents: payments.reduce((t, p) => t + p.amountPaidCents, 0),
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
  const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ?")
    .bind(paymentId)
    .first<{ event_id: number; status: string; amount_due_cents: number; amount_paid_cents: number; refunded_cents: number }>();
  if (!p) throw badRequest("找不到这笔应付款");
  const e = await getEvent(env, p.event_id);
  if (e.status !== "finalized") throw badRequest("这个活动已收齐归档，不能再修改");
  return { p, e };
}

/** Cash, Zelle or anything else: a manual receipt for whatever is still owed. */
adminEventRoutes.post("/payments/:pid/mark-paid", async (c) => {
  const id = Number(c.req.param("pid"));
  const { p, e } = await paymentEvent(c.env, id);
  const owed = p.amount_due_cents - p.amount_paid_cents;
  if (owed <= 0) throw badRequest("这笔已经付清了");
  await addReceipt(c.env, id, { amountCents: owed, method: "manual" });
  const settled = await checkCollected(c.env, e.id);
  return c.json({ ok: true, settled });
});

/** Takes back one payment (a mistaken manual mark, or a Venmo payment linked to the wrong bill). */
adminEventRoutes.post("/receipts/:rid/remove", async (c) => {
  const r = await c.env.DB.prepare("SELECT payment_id FROM payment_receipts WHERE id = ?")
    .bind(Number(c.req.param("rid")))
    .first<{ payment_id: number }>();
  if (!r) throw badRequest("找不到这笔付款记录");
  await paymentEvent(c.env, r.payment_id);
  await c.env.DB.batch([
    // A linked 待确认 row goes back to the list so the money is not forgotten.
    c.env.DB.prepare(
      `UPDATE inbound_payments SET state = 'open', linked_payment_id = NULL
       WHERE state = 'linked' AND venmo_txn_id = (SELECT venmo_txn_id FROM payment_receipts WHERE id = ?)`,
    ).bind(Number(c.req.param("rid"))),
    c.env.DB.prepare("DELETE FROM payment_receipts WHERE id = ?").bind(Number(c.req.param("rid"))),
    ...syncPayments(c.env.DB, "id = ?", r.payment_id),
  ]);
  return c.json({ ok: true });
});

/** The Owner sent the over-payment back. Allowed on archived events too: it changes no bill. */
adminEventRoutes.post("/payments/:pid/refunded", async (c) => {
  const id = Number(c.req.param("pid"));
  const res = await c.env.DB.prepare(
    `UPDATE payments SET refunded_cents = amount_paid_cents - amount_due_cents
     WHERE id = ? AND amount_paid_cents > amount_due_cents + refunded_cents`,
  )
    .bind(id)
    .run();
  if (res.meta.changes === 0) throw badRequest("这笔没有需要退的钱");
  return c.json({ ok: true });
});

adminEventRoutes.get("/inbound", async (c) =>
  c.json<InboundResponse>({
    open: await inboundRows(c.env, "open"),
    done: await inboundRows(c.env, "done"),
    payments: await openPayments(c.env),
    refunds: await refundRows(c.env),
  }),
);

async function openInbound(env: Env, id: number) {
  const i = await env.DB.prepare("SELECT * FROM inbound_payments WHERE id = ?")
    .bind(id)
    .first<{ id: number; state: string; amount_cents: number | null; venmo_txn_id: string | null; payer_name: string | null }>();
  if (!i) throw badRequest("找不到这笔收款");
  if (i.state !== "open") throw badRequest("这笔收款已经处理过了");
  return i;
}

/** The Owner says this Venmo payment belongs to someone's bill: add it there like any payment. */
adminEventRoutes.post("/inbound/:iid/link", async (c) => {
  const i = await openInbound(c.env, Number(c.req.param("iid")));
  const paymentId = num((await readJson(c.req.raw)).paymentId);
  const { e } = await paymentEvent(c.env, paymentId);
  if (i.amount_cents === null) throw badRequest("这笔收款没有金额，请改用「标记已付」");
  await c.env.DB.prepare("UPDATE inbound_payments SET state = 'linked', linked_payment_id = ? WHERE id = ?").bind(paymentId, i.id).run();
  await addReceipt(c.env, paymentId, { amountCents: i.amount_cents, method: "venmo", txnId: i.venmo_txn_id, payerName: i.payer_name });
  const settled = await checkCollected(c.env, e.id);
  return c.json({ ok: true, settled });
});

adminEventRoutes.post("/inbound/:iid/ignore", async (c) => {
  const i = await openInbound(c.env, Number(c.req.param("iid")));
  await c.env.DB.prepare("UPDATE inbound_payments SET state = 'ignored' WHERE id = ?").bind(i.id).run();
  return c.json({ ok: true });
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

/** 停止催款 / 恢复催款: the event stays unarchived and its unpaid bills stay. */
adminEventRoutes.post("/events/:id/dunning", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  if (e.status !== "finalized") throw badRequest("只有已结算、还没收齐的活动才能停止催款");
  const stop = (await readJson(c.req.raw)).stop === true;
  await c.env.DB.prepare("UPDATE events SET dunning_stopped = ? WHERE id = ?").bind(stop ? 1 : 0, e.id).run();
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

adminEventRoutes.get("/sheets", async (c) => c.json({ ...(await sheetsStatus(c.env)), script: await currentScript(c.env) }));

/** 开启同步 / 重新生成密钥: either way a fresh key, so a leaked script stops working. */
adminEventRoutes.post("/sheets/enable", async (c) => c.json({ script: await rotateExportKey(c.env) }));

adminEventRoutes.post("/sheets/disable", async (c) => {
  await disableExport(c.env);
  return c.json({ ok: true });
});
