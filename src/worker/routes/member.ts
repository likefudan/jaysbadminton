import { Hono } from "hono";
import { settle } from "../../shared/settle";
import type { MeResponse, MyEvent, MyPayment, MyRosterEntry, PaymentStatus } from "../../shared/types";
import { refundOf, savedInput, settleRows } from "../billing";
import { myStats } from "../stats";
import { getSettings } from "../db";
import { closeExpired, friendCap, getEvent, removeSignup, roster, setSignup, summaries, type EventRow, validateFriends } from "../events";
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
  return c.json<MeResponse>({ id: m.id, username: m.username, wechatNickname: m.wechat_nickname, isOwner: m.is_owner === 1, active: m.status === "active" });
});

memberRoutes.get("/:token/stats", async (c) => c.json(await myStats(c.env, c.get("member").id)));

memberRoutes.post("/:token/rename", async (c) => {
  const body = await readJson(c.req.raw);
  await renameMember(c.env, c.get("member"), str(body.username));
  return c.json({ ok: true });
});

memberRoutes.get("/:token/events", async (c) => {
  const m = c.get("member");
  await closeExpired(c.env);
  // Settled events stay on the member page for 30 days so people can see they are paid up.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized')
       OR (status = 'settled' AND settled_at > ?) ORDER BY start_at`,
  )
    .bind(new Date(Date.now() - 30 * 86400_000).toISOString())
    .all<EventRow>();
  const pays = await c.env.DB.prepare(
    "SELECT * FROM payments WHERE member_id = ?",
  )
    .bind(m.id)
    .all<{ event_id: number; amount_due_cents: number; amount_paid_cents: number; refunded_cents: number; payment_code: string; status: PaymentStatus }>();
  const s = await getSettings(c.env.DB, ["venmo_username", "zelle_account"]);
  const mine = await c.env.DB.prepare("SELECT event_id, friend_index, friend_name FROM registrations WHERE member_id = ?")
    .bind(m.id)
    .all<{ event_id: number; friend_index: number; friend_name: string | null }>();
  const list = await summaries(c.env, results);
  const events: MyEvent[] = [];
  for (const e of list) {
    const rows = mine.results.filter((r) => r.event_id === e.id);
    const friends = rows.filter((r) => r.friend_index > 0).sort((a, b) => a.friend_index - b.friend_index);
    const pay = pays.results.find((p) => p.event_id === e.id);
    // Settled events only matter to members who were billed; a disabled member only sees bills.
    if ((e.status === "settled" || m.status !== "active") && !pay) continue;
    let payment: MyPayment | null = null;
    if (pay && (e.status === "finalized" || e.status === "settled")) {
      const input = await savedInput(c.env, e.id);
      const bill = input ? settle(await settleRows(c.env, e.id), input).bills.find((b) => b.memberId === m.id) : undefined;
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
      const settled = e.status === "finalized" || e.status === "settled";
      names = (await roster(c.env, e.id)).map((r) => ({
        name: r.name,
        friendOf: r.friendIndex > 0 ? r.memberName : null,
        mine: r.memberId === m.id,
        absent: settled && !r.attended,
      }));
    }
    events.push({
      ...e,
      myFriends: rows.length === 0 ? null : friends.map((f) => f.friend_name ?? ""),
      canEdit: e.status === "open" && m.status === "active",
      payment,
      roster: names,
    });
  }
  return c.json({ events, friendCap: await friendCap(c.env) });
});

async function openEventFor(c: { env: import("../env").Env; get: (k: "member") => MemberRow }, id: string) {
  if (c.get("member").status !== "active") throw badRequest("你的账号已停用，不能报名。有疑问请联系管理员。");
  await closeExpired(c.env);
  const e = await getEvent(c.env, Number(id));
  if (e.status !== "open") throw badRequest("报名已截止，不能再修改");
  return e;
}

memberRoutes.post("/:token/events/:id/signup", async (c) => {
  const e = await openEventFor(c, c.req.param("id"));
  const body = await readJson(c.req.raw);
  const friends = validateFriends(body.friends ?? [], await friendCap(c.env));
  await setSignup(c.env, e.id, c.get("member").id, friends, false);
  return c.json({ ok: true });
});

memberRoutes.post("/:token/events/:id/cancel", async (c) => {
  const e = await openEventFor(c, c.req.param("id"));
  await removeSignup(c.env, e.id, c.get("member").id);
  return c.json({ ok: true });
});
