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
import { can, eventManager, eventPayee, memberRole, organizersEnabled, ownerId, payeeProfile } from "../organizers";
import { ownerName, payeeName } from "../payees";
import {
  bookedCourts,
  broughtBy,
  closeExpired,
  friendCap,
  friendCount,
  getEvent,
  guestChoices,
  guestCount,
  guestsMissed,
  removeSignup,
  roster,
  setSignup,
  summaries,
  type EventRow,
  validateFriends,
  validateGuests,
} from "../events";
import type { Env } from "../env";
import { badRequest, HttpError, invalidLink, readJson, str } from "../http";
import { type MemberRow, memberByToken, renameMember } from "../members";
import { developerMember } from "../developer";
import { pushBrought, pushGuestLeft, pushWelcome, sendSoon, subscribe, unsubscribe, vapidKeys } from "../push";
import { googleMember, requireSameOrigin } from "../googleAuth";
import { readCourtPhoto } from "../courtPhoto";
import {
  calorieReadDays,
  caloriesOf,
  canRead,
  deleteCalories,
  myCalories,
  setCalorieBoard,
  shortcutOutdated,
  shortcutSetting,
  startUpload,
} from "../calories";
import {
  addAccount,
  addAccounts,
  clearAccounts,
  queueInfo,
  queueLive,
  removeAccount,
  removeCourt,
  removeCourts,
  saveCourt,
} from "../courtQueue";

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
       OR id IN (SELECT event_id FROM registrations WHERE member_id = ?1 OR paid_by = ?1)
       OR id IN (SELECT event_id FROM payments WHERE member_id = ?1))
     ORDER BY start_at DESC`,
  )
    .bind(m.id)
    .all<EventRow>();
  const mine = await myRows(c.env, m);
  const generalCap = await friendCap(c.env);

  // 历史活动: over and paid up. Kept light (no roster or bill breakdown) so years of history stay
  // within the per-request query budget; the event's own page (/e/:code) has the full card.
  const ended = new Date().toISOString();
  const isHistory = (e: EventRow) =>
    (e.status === "finalized" || e.status === "settled") &&
    e.end_at <= ended &&
    // Brought by someone (带群友): over once whoever brought them has paid.
    (mine.payOf(e.id)?.status ?? mine.broughtOf(e.id)?.status ?? "paid") === "paid";
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
      friends: rows.filter((r) => r.friend_index > 0).length + mine.guestsOf(e.id).length,
      paidBy: mine.broughtOf(e.id)?.username ?? null,
      kcal: mine.kcalOf(e.id),
      noFee: e.no_fee === 1,
      unsettled: e.unsettled === 1,
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
 * history included (an event over and paid up still shows who came and what they paid). One they
 * are not on still gets the card (no roster, no bill, 你没有报名), so the page keeps the new look.
 * null only when cancelled: the page shows the public card.
 */
memberRoutes.get("/:token/events/:id", async (c) => {
  const m = c.get("member");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new HttpError(404, "event_not_found", "找不到这个活动");
  const row = await getEvent(c.env, id);
  const list =
    row.status === "cancelled"
      ? []
      : await myEvents(c.env, m, [row], await myRows(c.env, m, id), await friendCap(c.env), true);
  return c.json<MyEventResponse>({ event: list[0] ?? null });
});

type MyRows = Awaited<ReturnType<typeof myRows>>;

/** The member's own sign-ups and bills (all of them, or one event's), read once and looked up per event. */
async function myRows(env: Env, m: MemberRow, eventId?: number) {
  const only = eventId === undefined ? "" : " AND event_id = ?";
  const args = eventId === undefined ? [m.id] : [m.id, eventId];
  const [pays, regs, guests, brought, kcal] = await Promise.all([
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
    // 带群友: the group members they bring and pay for, in the order they were added.
    env.DB.prepare(
      `SELECT r.event_id, r.member_id, m.username FROM registrations r JOIN members m ON m.id = r.member_id
       WHERE r.paid_by = ?${only.replace("event_id", "r.event_id")} ORDER BY r.id`,
    )
      .bind(...args)
      .all<{ event_id: number; member_id: string; username: string }>(),
    // …and whoever brought them, with that person's bill once there is one.
    env.DB.prepare(
      `SELECT r.event_id, r.paid_by, m.username, p.status FROM registrations r JOIN members m ON m.id = r.paid_by
       LEFT JOIN payments p ON p.event_id = r.event_id AND p.member_id = r.paid_by
       WHERE r.member_id = ? AND r.friend_index = 0 AND r.paid_by IS NOT NULL${only.replace("event_id", "r.event_id")}`,
    )
      .bind(...args)
      .all<{ event_id: number; paid_by: string; username: string; status: PaymentStatus | null }>(),
    caloriesOf(env, m.id, eventId === undefined ? undefined : [eventId]),
  ]);
  return {
    payOf: (id: number) => pays.results.find((p) => p.event_id === id),
    regsOf: (id: number) => regs.results.filter((r) => r.event_id === id),
    guestsOf: (id: number) => guests.results.filter((r) => r.event_id === id),
    broughtOf: (id: number) => brought.results.find((r) => r.event_id === id),
    kcalOf: (id: number) => kcal.get(id) ?? null,
  };
}

/**
 * The 我的活动 cards for these events, in order; events they are not on and can't join are left out,
 * unless `all` (an event's own page, which shows its card either way).
 */
async function myEvents(
  env: Env,
  m: MemberRow,
  results: EventRow[],
  mine: MyRows,
  generalCap: number,
  all = false,
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
  const [list, readDays, shortcut] = await Promise.all([
    summaries(env, results),
    calorieReadDays(env),
    shortcutSetting(env),
  ]);
  const events: MyEvent[] = [];
  for (const e of list) {
    const row = rowOf.get(e.id)!;
    const runs = await runsEvent(env, m, row);
    const rows = mine.regsOf(e.id);
    const friends = rows.filter((r) => r.friend_index > 0).sort((a, b) => a.friend_index - b.friend_index);
    const guests = mine.guestsOf(e.id);
    const brought = mine.broughtOf(e.id);
    const pay = mine.payOf(e.id);
    const selfOn = rows.some((r) => r.friend_index === 0);
    // On the list in any way: themselves, or friends or group members under them.
    const onIt = rows.length > 0 || guests.length > 0;
    // Events they are not on are only offered while open, and never to a disabled member.
    if (!all && !onIt && !pay && (e.status !== "open" || m.status !== "active")) continue;
    const settled = e.status === "finalized" || e.status === "settled";
    // One roster read serves both the bill breakdown and the list of who is coming.
    const people = onIt || (pay && settled) ? await roster(env, e.id) : [];
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
        // A group member someone brought shows who did, except to themselves (they see 我).
        friendOf: r.friendIndex > 0 ? r.memberName : r.memberId !== m.id ? r.paidByName : null,
        mine: r.memberId === m.id || r.paidBy === m.id,
        absent: settled && !r.attended,
      }));
    }
    events.push({
      ...e,
      myFriends: onIt ? friends.map((f) => f.friend_name ?? "") : null,
      myGuests: guests.map((g) => ({ id: g.member_id, name: g.username })),
      broughtBy: brought
        ? { name: brought.username, billed: settled && brought.status !== null, paid: brought.status === "paid" }
        : null,
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
      queue: (onIt || runs) && queueLive(row) ? await queueInfo(env, row, m.id, managesQueue(env, m)) : null,
      courts: onIt || runs ? bookedCourts(row) : [],
      kcal: mine.kcalOf(e.id),
      kcalOpen: canRead(row, selfOn, readDays),
      kcalUpdate: canRead(row, selfOn, readDays) && shortcutOutdated(m.calorie_shortcut_v, shortcut.version),
      kcalInstall: canRead(row, selfOn, readDays) ? shortcut.url : "",
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
  // Brought by someone (带群友): they're on the list already and can't change it or bring anyone.
  const by = await broughtBy(c.env, e.id, m.id);
  if (by) throw badRequest(`${await payeeName(c.env.DB, by)} 已经带你报名了。要自己报名，请先点「我不去了」`);
  const [cap, keep] = await Promise.all([runs ? null : friendCap(c.env), friendCount(c.env, e.id, m.id)]);
  // Left out (a page from before 带群友): the group members they bring stay as they are, and count.
  const guests = body.guests === undefined ? undefined : await validateGuests(c.env, e.id, m.id, body.guests);
  const friends = validateFriends(
    body.friends ?? [],
    cap,
    keep,
    guests?.length ?? (await guestCount(c.env, e.id, m.id)),
  );
  const { added, removed, missed } = await setSignup(c.env, e.id, m.id, friends, false, guests);
  const pushed = await Promise.all([
    ...added.map((g) => pushBrought(c.env, e, g, m.id, m.id, true)),
    ...removed.map((g) => pushBrought(c.env, e, g, m.id, m.id, false)),
  ]);
  if (pushed.some(Boolean)) sendSoon(c);
  if (missed.length > 0) throw guestsMissed(missed);
  return c.json({ ok: true });
});

/** 取消报名, with their friends and the group members they bring; 我不去了 for someone brought. */
memberRoutes.post("/:token/events/:id/cancel", async (c) => {
  const { e } = await openEventFor(c, c.req.param("id"));
  const m = c.get("member");
  const { guests, paidBy } = await removeSignup(c.env, e.id, m.id);
  const pushed = await Promise.all([
    ...guests.map((g) => pushBrought(c.env, e, g, m.id, m.id, false)),
    ...(paidBy ? [pushGuestLeft(c.env, e, paidBy, m.id)] : []),
  ]);
  if (pushed.some(Boolean)) sendSoon(c);
  return c.json({ ok: true });
});

/**
 * 选群友: the members they could bring to this event, by name: everyone active but themselves,
 * with why someone can't be picked (on the list already, or brought by someone else).
 */
memberRoutes.get("/:token/events/:id/guests", async (c) => {
  const { e } = await openEventFor(c, c.req.param("id"));
  return c.json({ members: await guestChoices(c.env, e.id, c.get("member").id) });
});

/** 球场排队 批量删除 and 清空账号 are for the Owner and admins (群主、管理员). */
const managesQueue = (env: Env, m: MemberRow) => can(memberRole(env, m), "group");

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

memberRoutes.post("/:token/events/:id/queue/accounts/batch", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  return c.json(await addAccounts(c.env, e, m.id, await readJson(c.req.raw)));
});

// 清空: the Owner and admins take off every account on the event at once (Ke Li).
memberRoutes.post("/:token/events/:id/queue/accounts/clear", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  if (!managesQueue(c.env, m)) throw badRequest("只有群主和管理员可以清空账号");
  return c.json({ removed: await clearAccounts(c.env, e) });
});

memberRoutes.post("/:token/events/:id/queue/accounts/:aid/remove", async (c) => {
  const { e, m, runs } = await queueEventFor(c, c.req.param("id"));
  // Anyone's account: the Owner, admins and whoever runs this event (Ke Li).
  await removeAccount(c.env, e, m.id, runs || managesQueue(c.env, m), Number(c.req.param("aid")));
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

// 批量删除: the Owner and admins clear several courts at once (Ke Li); others remove them one by one.
memberRoutes.post("/:token/events/:id/queue/courts/remove", async (c) => {
  const { e, m } = await queueEventFor(c, c.req.param("id"));
  if (!managesQueue(c.env, m)) throw badRequest("只有群主和管理员可以批量删除");
  return c.json({ removed: await removeCourts(c.env, e, await readJson(c.req.raw)) });
});

memberRoutes.post("/:token/events/:id/queue/courts/:cid/remove", async (c) => {
  const { e } = await queueEventFor(c, c.req.param("id"));
  await removeCourt(c.env, e, Number(c.req.param("cid")));
  return c.json({ ok: true });
});

// 卡路里: 读取 hands the Shortcut a one-time code for this event; 个人信息 shows the totals and the
// 卡路里榜 choice.
memberRoutes.post("/:token/events/:id/calories", async (c) => {
  const e = await getEvent(c.env, Number(c.req.param("id")));
  return c.json(await startUpload(c.env, c.get("member"), e, new URL(c.req.url).origin));
});

memberRoutes.get("/:token/calories", async (c) => c.json(await myCalories(c.env, c.get("member"))));

// Deleting: one event's number ({id}, or {code} from an older page) or all of them ({all: true}).
memberRoutes.post("/:token/calories/delete", async (c) => {
  const body = await readJson(c.req.raw);
  if (Number.isSafeInteger(body.id) && (body.id as number) > 0)
    await deleteCalories(c.env, c.get("member"), { id: body.id as number });
  else if (typeof body.code === "string") await deleteCalories(c.env, c.get("member"), { code: body.code });
  else if (body.all === true) await deleteCalories(c.env, c.get("member"));
  else throw badRequest("要删除哪一场？");
  return c.json({ ok: true });
});

memberRoutes.post("/:token/calories/board", async (c) => {
  const body = await readJson(c.req.raw);
  await setCalorieBoard(c.env, c.get("member"), body.on === true);
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
