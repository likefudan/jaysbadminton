import { Hono } from "hono";
import { settle } from "../../shared/settle";
import type {
  MeResponse,
  MyEvent,
  MyEventResponse,
  MyEventsResponse,
  MyHistoryEvent,
  MyPayment,
  MyRosterEntry,
  PaymentStatus,
} from "../../shared/types";
import { refundOf, savedInput, toSettleRows } from "../billing";
import { memberProfile, setMemberEmail } from "../profile";
import { myStats } from "../stats";
import { eventManager, eventPayee, memberRole, organizersEnabled, ownerId, payeeProfile } from "../organizers";
import { ownerName, payeeName } from "../payees";
import {
  bookedCourts,
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
import { badRequest, HttpError, invalidLink, readJson, str } from "../http";
import { type MemberRow, memberByToken, renameMember } from "../members";
import { developerMember } from "../developer";
import { pushWelcome, sendSoon, subscribe, unsubscribe, vapidKeys } from "../push";
import { googleMember, requireSameOrigin } from "../googleAuth";
import { readCourtPhoto } from "../courtPhoto";
import { addAccount, queueInfo, queueLive, removeAccount, removeCourt, saveCourt } from "../courtQueue";

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

memberRoutes.get("/:token/me", async (c) => {
  const m = c.get("member");
  return c.json<MeResponse>({
    id: m.id,
    username: m.username,
    wechatNickname: m.wechat_nickname,
    isOwner: m.is_owner === 1,
    // 管理页 is reached through Google (/admin/google), so only offered on the Google-signed-in
    // page (not the staging developer login, which has its own switch to the admin pages).
    canAdmin:
      c.req.param("token") === "session" &&
      !(await developerMember(c)) &&
      m.status === "active" &&
      memberRole(c.env, m) !== "member",
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
  const mine = await myRows(c.env, m);
  const generalCap = await friendCap(c.env);

  // 历史活动: over and paid up. Kept light (no roster or bill breakdown) so years of history stay
  // within the per-request query budget; the event's own page (/e/:code) has the full card.
  const ended = new Date().toISOString();
  const isHistory = (e: EventRow) =>
    (e.status === "finalized" || e.status === "settled") &&
    e.end_at <= ended &&
    (mine.payOf(e.id)?.status ?? "paid") === "paid";
  const history: MyHistoryEvent[] = results.filter(isHistory).map((e) => {
    const rows = mine.regsOf(e.id);
    return {
      id: e.id,
      code: e.code,
      date: e.date,
      title: e.title,
      location: e.location,
      amountCents: mine.payOf(e.id)?.amount_due_cents ?? null,
      attended: rows.some((r) => r.friend_index === 0 && r.attended === 1),
      friends: rows.filter((r) => r.friend_index > 0).length,
    };
  });

  return c.json<MyEventsResponse>({
    events: await myEvents(
      c.env,
      m,
      results.filter((e) => !isHistory(e)),
      mine,
      generalCap,
    ),
    history,
    friendCap: generalCap,
  });
});

/**
 * One event as it shows on 我的活动, for its own page (/e/:code): the same card, roster and bill,
 * history included (an event over and paid up still shows who came and what they paid). null when
 * it isn't theirs to see that way (not on it and not open, or cancelled): the page shows the public card.
 */
memberRoutes.get("/:token/events/:id", async (c) => {
  const m = c.get("member");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new HttpError(404, "event_not_found", "找不到这个活动");
  const row = await getEvent(c.env, id);
  const list =
    row.status === "cancelled"
      ? []
      : await myEvents(c.env, m, [row], await myRows(c.env, m, id), await friendCap(c.env));
  return c.json<MyEventResponse>({ event: list[0] ?? null });
});

type MyRows = Awaited<ReturnType<typeof myRows>>;

/** The member's own sign-ups and bills (all of them, or one event's), read once and looked up per event. */
async function myRows(env: Env, m: MemberRow, eventId?: number) {
  const only = eventId === undefined ? "" : " AND event_id = ?";
  const args = eventId === undefined ? [m.id] : [m.id, eventId];
  const [pays, regs] = await Promise.all([
    env.DB.prepare(`SELECT * FROM payments WHERE member_id = ?${only}`)
      .bind(...args)
      .all<{
        event_id: number;
        amount_due_cents: number;
        amount_paid_cents: number;
        refunded_cents: number;
        payment_code: string;
        status: PaymentStatus;
      }>(),
    env.DB.prepare(`SELECT event_id, friend_index, friend_name, attended FROM registrations WHERE member_id = ?${only}`)
      .bind(...args)
      .all<{ event_id: number; friend_index: number; friend_name: string | null; attended: number }>(),
  ]);
  return {
    payOf: (id: number) => pays.results.find((p) => p.event_id === id),
    regsOf: (id: number) => regs.results.filter((r) => r.event_id === id),
  };
}

/** The 我的活动 cards for these events, in order; events they are not on and can't join are left out. */
async function myEvents(
  env: Env,
  m: MemberRow,
  results: EventRow[],
  mine: MyRows,
  generalCap: number,
): Promise<MyEvent[]> {
  // Where each event's money goes: its payee's accounts, looked up once per payee.
  const payees = new Map<string | null, Promise<{ name: string; venmo: string; zelle: string }>>();
  const payTo = (id: string | null) => {
    let p = payees.get(id);
    if (!p) {
      p = Promise.all([payeeName(env.DB, id), payeeProfile(env.DB, id)]).then(([name, profile]) => ({
        name,
        venmo: profile?.venmoUsername ?? "",
        zelle: profile?.zelleAccount ?? "",
      }));
      payees.set(id, p);
    }
    return p;
  };
  const rowOf = new Map(results.map((e) => [e.id, e]));
  // 组织：the organizer's name on the events they run; nothing on the Owner's, as before.
  // Only while the feature is on: with it off, nobody is shown as running an event (as before).
  const named = organizersEnabled(env);
  const owner = named ? await ownerId(env.DB) : null;
  const organizers = new Map<string, Promise<string>>();
  const organizerOf = async (e: EventRow) => {
    if (!named) return null;
    const id = await eventManager(env.DB, e);
    // Nobody on the Owner's, and not on one's own (an organizer looking at the events they run).
    if (!id || id === owner || id === m.id) return null;
    if (!organizers.has(id)) organizers.set(id, payeeName(env.DB, id));
    return organizers.get(id)!;
  };
  // Members see people by name, the Owner's included (Ke Li: names, not 群主).
  const ownerLabel = await ownerName(env.DB);
  const managers = new Map<string | null, Promise<string>>();
  const managerOf = async (e: EventRow) => {
    const id = await eventManager(env.DB, e);
    if (!managers.has(id)) managers.set(id, payeeName(env.DB, id));
    return managers.get(id)!;
  };
  const list = await summaries(env, results);
  const events: MyEvent[] = [];
  for (const e of list) {
    const row = rowOf.get(e.id)!;
    const runs = await runsEvent(env, m, row);
    const rows = mine.regsOf(e.id);
    const friends = rows.filter((r) => r.friend_index > 0).sort((a, b) => a.friend_index - b.friend_index);
    const pay = mine.payOf(e.id);
    const selfOn = rows.some((r) => r.friend_index === 0);
    // Events they are not on are only offered while open, and never to a disabled member.
    if (rows.length === 0 && !pay && (e.status !== "open" || m.status !== "active")) continue;
    const settled = e.status === "finalized" || e.status === "settled";
    // One roster read serves both the bill breakdown and the list of who is coming.
    const people = rows.length > 0 || (pay && settled) ? await roster(env, e.id) : [];
    let payment: MyPayment | null = null;
    if (pay && settled) {
      const input = await savedInput(env, e.id);
      const bill = input ? settle(toSettleRows(people), input).bills.find((b) => b.memberId === m.id) : undefined;
      const to = await payTo(await eventPayee(env.DB, row));
      payment = {
        amountCents: pay.amount_due_cents,
        paidCents: pay.amount_paid_cents,
        refundCents: refundOf(pay),
        status: pay.status,
        code: pay.payment_code,
        shares: bill?.shares ?? [],
        payeeName: to.name,
        venmoUsername: to.venmo,
        zelleAccount: to.zelle,
      };
    }
    // Who else is coming: only for members on the list themselves (the public pages show a count).
    let names: MyRosterEntry[] | null = null;
    if (selfOn) {
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
      selfSignedUp: selfOn,
      canEdit: m.status === "active" && (e.status === "open" || (runs && e.status === "closed")),
      friendCap: runs ? MANAGER_FRIEND_MAX : generalCap,
      organizer: await organizerOf(row),
      runByMe: runs && named,
      managerName: await managerOf(row),
      ownerName: ownerLabel,
      payment,
      roster: names,
      // 球场排队: for everyone playing (friends' hosts too) and whoever runs it.
      queue: (rows.length > 0 || runs) && queueLive(row) ? await queueInfo(env, row, m.id) : null,
      courts: rows.length > 0 || runs ? bookedCourts(row) : [],
    });
  }
  return events;
}

/**
 * Whoever runs the event (本场负责人: the Owner on theirs, an organizer on theirs) signing up from
 * their own member page follows the same rules as 我的报名 on the admin page: no friend cap, and
 * changes allowed after the deadline until Finalize. On someone else's event they are a player
 * like anyone else (the Owner can still change any list from the admin page).
 */
const runsEvent = async (env: Env, m: MemberRow, e: EventRow) =>
  // An organizer only while they are one and the feature is on; not money, so the flag may gate it.
  memberRole(env, m) !== "member" && (await eventManager(env.DB, e)) === m.id;
const MANAGER_FRIEND_MAX = 20;

async function openEventFor(c: { env: Env; get: (k: "member") => MemberRow }, id: string) {
  const m = c.get("member");
  if (m.status !== "active") throw badRequest(`你的账号已停用，不能报名。有疑问请联系 ${await ownerName(c.env.DB)}。`);
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(id));
  const runs = await runsEvent(c.env, m, e);
  if (runs && e.status === "closed") return { e, runs };
  if (e.status !== "open")
    throw badRequest(runs ? "已经结算，不能再改自己的报名；需要调整请在管理页直接改名单" : "报名已截止，不能再修改");
  return { e, runs };
}

memberRoutes.post("/:token/events/:id/signup", async (c) => {
  const { e, runs } = await openEventFor(c, c.req.param("id"));
  const body = await readJson(c.req.raw);
  const m = c.get("member");
  const [cap, keep] = await Promise.all([runs ? null : friendCap(c.env), friendCount(c.env, e.id, m.id)]);
  const friends = validateFriends(body.friends ?? [], cap, keep);
  await setSignup(c.env, e.id, m.id, friends, false);
  return c.json({ ok: true });
});

memberRoutes.post("/:token/events/:id/cancel", async (c) => {
  const { e } = await openEventFor(c, c.req.param("id"));
  await removeSignup(c.env, e.id, c.get("member").id);
  return c.json({ ok: true });
});

/** 球场排队 changes: players on the event (or whoever runs it), while the feature is on for it. */
async function queueEventFor(c: { env: Env; get: (k: "member") => MemberRow }, id: string) {
  const m = c.get("member");
  if (m.status !== "active") throw badRequest(`你的账号已停用。有疑问请联系 ${await ownerName(c.env.DB)}。`);
  const e = await getEvent(c.env, Number(id));
  if (!queueLive(e)) throw badRequest("这个活动没有开球场排队，或者已经结束了");
  const runs = await runsEvent(c.env, m, e);
  const on = await c.env.DB.prepare("SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ? LIMIT 1")
    .bind(e.id, m.id)
    .first();
  if (!on && !runs) throw badRequest("报名了这个活动才能登记球场");
  return { e, m, runs };
}

memberRoutes.post("/:token/events/:id/queue/accounts", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  await addAccount(c.env, e, m.id, await readJson(c.req.raw));
  return c.json({ ok: true });
});

memberRoutes.post("/:token/events/:id/queue/accounts/:aid/remove", async (c) => {
  const { e, m, runs } = await queueEventFor(c, c.req.param("id"));
  await removeAccount(c.env, e, m.id, runs, Number(c.req.param("aid")));
  return c.json({ ok: true });
});

memberRoutes.post("/:token/events/:id/queue/courts", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  await saveCourt(c.env, e, m.id, await readJson(c.req.raw));
  return c.json({ ok: true });
});

// 拍照登记: read a photo of the hall's screen; the answer fills the form, nothing is saved as a court.
memberRoutes.post("/:token/events/:id/queue/photo", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  return c.json(await readCourtPhoto(c.env, e, m.id, await readJson(c.req.raw)));
});

memberRoutes.post("/:token/events/:id/queue/courts/:cid/remove", async (c) => {
  const { e } = await queueEventFor(c, c.req.param("id"));
  await removeCourt(c.env, e, Number(c.req.param("cid")));
  return c.json({ ok: true });
});

// 推送通知: the browser asks for the site's public key, then hands over its subscription.
memberRoutes.get("/:token/push", async (c) => c.json({ publicKey: (await vapidKeys(c.env)).publicKey }));

memberRoutes.post("/:token/push/subscribe", async (c) => {
  const body = await readJson(c.req.raw);
  const session = c.req.param("token") === "session";
  const endpoint = await subscribe(c.env, c.get("member").id, body);
  // Turned on just now (not the page re-syncing): one push so they see it works.
  // (No link in it: the service worker opens the link page it saved.)
  if (body.welcome === true) {
    await pushWelcome(c.env, c.get("member").id, endpoint, session ? "/me" : "/");
    sendSoon(c, endpoint);
  }
  return c.json({ ok: true });
});

memberRoutes.post("/:token/push/unsubscribe", async (c) => {
  const removed = await unsubscribe(c.env, c.get("member").id, str((await readJson(c.req.raw)).endpoint));
  return c.json({ ok: true, removed });
});
