import { Hono } from "hono";
import { settle } from "../../shared/settle";
import type {
  MeResponse,
  MyEvent,
  MyEventsResponse,
  MyHistoryEvent,
  MyPayment,
  MyRosterEntry,
  PaymentStatus,
} from "../../shared/types";
import { refundOf, savedInput, toSettleRows } from "../billing";
import { memberProfile, setMemberEmail } from "../profile";
import { myStats } from "../stats";
import { getSettings } from "../db";
import {
  closeExpired,
  friendCap,
  friendCount,
  getEvent,
  removeSignup,
  roster,
  setSignup,
  summaries,
  type EventRow,
  validateFriends,
} from "../events";
import type { Env } from "../env";
import { badRequest, invalidLink, readJson, str } from "../http";
import { type MemberRow, memberByToken, renameMember } from "../members";
import { googleMember, requireSameOrigin } from "../googleAuth";

type Vars = { member: MemberRow };
export const memberRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

memberRoutes.use("/:token/*", async (c, next) => {
  const session = c.req.param("token") === "session";
  if (session && c.req.method !== "GET") requireSameOrigin(c);
  const m = session ? await googleMember(c) : await memberByToken(c.env, c.req.param("token"));
  if (!m) throw invalidLink();
  c.set("member", m);
  await next();
});

memberRoutes.get("/:token/me", (c) => {
  const m = c.get("member");
  return c.json<MeResponse>({
    id: m.id,
    username: m.username,
    wechatNickname: m.wechat_nickname,
    isOwner: m.is_owner === 1,
    active: m.status === "active",
  });
});

memberRoutes.get("/:token/stats", async (c) => c.json(await myStats(c.env, c.get("member").id)));

// 个人信息: basics and the activity map; the admin's note never appears here.
memberRoutes.get("/:token/profile", async (c) => c.json(await memberProfile(c.env, c.get("member"))));

memberRoutes.post("/:token/email", async (c) => {
  const body = await readJson(c.req.raw);
  await setMemberEmail(c.env, c.get("member"), str(body.email));
  return c.json({ ok: true });
});

memberRoutes.post("/:token/rename", async (c) => {
  const body = await readJson(c.req.raw);
  await renameMember(c.env, c.get("member"), str(body.username));
  return c.json({ ok: true });
});

memberRoutes.get("/:token/events", async (c) => {
  const m = c.get("member");
  // 我的活动: every event they signed up for or were billed for (cancelled ones left out), plus the
  // open ones they can still join; newest first.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM events WHERE status != 'cancelled' AND (status = 'open'
       OR id IN (SELECT event_id FROM registrations WHERE member_id = ?)
       OR id IN (SELECT event_id FROM payments WHERE member_id = ?))
     ORDER BY start_at DESC`,
  )
    .bind(m.id, m.id)
    .all<EventRow>();
  const pays = await c.env.DB.prepare("SELECT * FROM payments WHERE member_id = ?").bind(m.id).all<{
    event_id: number;
    amount_due_cents: number;
    amount_paid_cents: number;
    refunded_cents: number;
    payment_code: string;
    status: PaymentStatus;
  }>();
  const s = await getSettings(c.env.DB, ["venmo_username", "zelle_account"]);
  const mine = await c.env.DB.prepare(
    "SELECT event_id, friend_index, friend_name, attended FROM registrations WHERE member_id = ?",
  )
    .bind(m.id)
    .all<{ event_id: number; friend_index: number; friend_name: string | null; attended: number }>();

  // 历史活动: over and paid up. Kept light (no roster or bill breakdown) so years of history stay
  // within the per-request query budget.
  const ended = new Date().toISOString();
  const payOf = (id: number) => pays.results.find((p) => p.event_id === id);
  const isHistory = (e: EventRow) =>
    (e.status === "finalized" || e.status === "settled") &&
    e.end_at <= ended &&
    (payOf(e.id)?.status ?? "paid") === "paid";
  const history: MyHistoryEvent[] = results.filter(isHistory).map((e) => {
    const rows = mine.results.filter((r) => r.event_id === e.id);
    return {
      id: e.id,
      code: e.code,
      date: e.date,
      title: e.title,
      location: e.location,
      amountCents: payOf(e.id)?.amount_due_cents ?? null,
      attended: rows.some((r) => r.friend_index === 0 && r.attended === 1),
      friends: rows.filter((r) => r.friend_index > 0).length,
    };
  });

  const list = await summaries(
    c.env,
    results.filter((e) => !isHistory(e)),
  );
  const events: MyEvent[] = [];
  for (const e of list) {
    const rows = mine.results.filter((r) => r.event_id === e.id);
    const friends = rows.filter((r) => r.friend_index > 0).sort((a, b) => a.friend_index - b.friend_index);
    const pay = payOf(e.id);
    // Events they are not on are only offered while open, and never to a disabled member.
    if (rows.length === 0 && !pay && (e.status !== "open" || m.status !== "active")) continue;
    const settled = e.status === "finalized" || e.status === "settled";
    // One roster read serves both the bill breakdown and the list of who is coming.
    const people = rows.length > 0 || (pay && settled) ? await roster(c.env, e.id) : [];
    let payment: MyPayment | null = null;
    if (pay && settled) {
      const input = await savedInput(c.env, e.id);
      const bill = input ? settle(toSettleRows(people), input).bills.find((b) => b.memberId === m.id) : undefined;
      payment = {
        amountCents: pay.amount_due_cents,
        paidCents: pay.amount_paid_cents,
        refundCents: refundOf(pay),
        status: pay.status,
        code: pay.payment_code,
        shares: bill?.shares ?? [],
        venmoUsername: s.venmo_username ?? "",
        zelleAccount: s.zelle_account ?? "",
      };
    }
    // Who else is coming: only for members on the list themselves (the public pages show a count).
    let names: MyRosterEntry[] | null = null;
    if (rows.length > 0) {
      names = people.map((r) => ({
        name: r.name,
        friendOf: r.friendIndex > 0 ? r.memberName : null,
        mine: r.memberId === m.id,
        absent: settled && !r.attended,
      }));
    }
    events.push({
      ...e,
      myFriends: rows.length === 0 ? null : friends.map((f) => f.friend_name ?? ""),
      canEdit: m.status === "active" && (e.status === "open" || (ownerRules(m) && e.status === "closed")),
      payment,
      roster: names,
    });
  }
  return c.json<MyEventsResponse>({
    events,
    history,
    friendCap: ownerRules(m) ? OWNER_FRIEND_MAX : await friendCap(c.env),
  });
});

/**
 * The Owner signing up from their own member page (via Google) follows the same rules as 我的报名
 * on the admin page: no friend cap, and changes allowed after the deadline until Finalize.
 */
const ownerRules = (m: MemberRow) => m.is_owner === 1;
const OWNER_FRIEND_MAX = 20;

async function openEventFor(c: { env: import("../env").Env; get: (k: "member") => MemberRow }, id: string) {
  const m = c.get("member");
  if (m.status !== "active") throw badRequest("你的账号已停用，不能报名。有疑问请联系管理员。");
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(id));
  if (ownerRules(m) && e.status === "closed") return e;
  if (e.status !== "open")
    throw badRequest(
      ownerRules(m) ? "已经结算，不能再改自己的报名；需要调整请在管理页直接改名单" : "报名已截止，不能再修改",
    );
  return e;
}

memberRoutes.post("/:token/events/:id/signup", async (c) => {
  const e = await openEventFor(c, c.req.param("id"));
  const body = await readJson(c.req.raw);
  const m = c.get("member");
  const [cap, keep] = ownerRules(m) ? [null, 0] : await Promise.all([friendCap(c.env), friendCount(c.env, e.id, m.id)]);
  const friends = validateFriends(body.friends ?? [], cap, keep);
  await setSignup(c.env, e.id, c.get("member").id, friends, false);
  return c.json({ ok: true });
});

memberRoutes.post("/:token/events/:id/cancel", async (c) => {
  const e = await openEventFor(c, c.req.param("id"));
  await removeSignup(c.env, e.id, c.get("member").id);
  return c.json({ ok: true });
});
