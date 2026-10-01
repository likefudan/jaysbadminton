import { Hono } from "hono";
import type { MeResponse, MyEvent } from "../../shared/types";
import { closeExpired, friendCap, getEvent, removeSignup, setSignup, summaries, type EventRow, validateFriends } from "../events";
import type { Env } from "../env";
import { badRequest, invalidLink, readJson, str } from "../http";
import { type MemberRow, memberByToken, renameMember } from "../members";

type Vars = { member: MemberRow };
export const memberRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

memberRoutes.use("/:token/*", async (c, next) => {
  const m = await memberByToken(c.env, c.req.param("token"));
  if (!m) throw invalidLink();
  c.set("member", m);
  await next();
});

memberRoutes.get("/:token/me", (c) => {
  const m = c.get("member");
  return c.json<MeResponse>({ id: m.id, username: m.username, wechatNickname: m.wechat_nickname, isOwner: m.is_owner === 1 });
});

memberRoutes.post("/:token/rename", async (c) => {
  const body = await readJson(c.req.raw);
  await renameMember(c.env, c.get("member"), str(body.username));
  return c.json({ ok: true });
});

memberRoutes.get("/:token/events", async (c) => {
  const m = c.get("member");
  await closeExpired(c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at",
  ).all<EventRow>();
  const mine = await c.env.DB.prepare("SELECT event_id, friend_index, friend_name FROM registrations WHERE member_id = ?")
    .bind(m.id)
    .all<{ event_id: number; friend_index: number; friend_name: string | null }>();
  const list = await summaries(c.env, results);
  const events: MyEvent[] = list.map((e) => {
    const rows = mine.results.filter((r) => r.event_id === e.id);
    const friends = rows.filter((r) => r.friend_index > 0).sort((a, b) => a.friend_index - b.friend_index);
    return {
      ...e,
      myFriends: rows.length === 0 ? null : friends.map((f) => f.friend_name ?? ""),
      canEdit: e.status === "open",
    };
  });
  return c.json({ events, friendCap: await friendCap(c.env) });
});

async function openEventFor(c: { env: import("../env").Env }, id: string) {
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
