import { Hono } from "hono";
import type { HomeResponse, PublicEvent } from "../../shared/types";
import { closeExpired, detail, summaries, type EventRow } from "../events";
import { adminLinkExists, checkPassword, issueAdminToken, startSession } from "../auth";
import type { Env } from "../env";
import { HttpError, readJson, str } from "../http";
import { siteTheme, siteTitle } from "../site";
import { createMember, issueMemberToken, memberLink } from "../members";

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/site", async (c) => c.json({ title: await siteTitle(c.env), theme: await siteTheme(c.env) }));

publicRoutes.get("/home", async (c) => {
  await closeExpired(c.env);
  const current = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at",
  ).all<EventRow>();
  const past = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('settled', 'cancelled') ORDER BY start_at DESC LIMIT 20",
  ).all<EventRow>();
  return c.json<HomeResponse>({
    currentEvents: await summaries(c.env, current.results),
    pastEvents: await summaries(c.env, past.results),
    leaderboard: [],
  });
});

publicRoutes.get("/events/:code", async (c) => {
  await closeExpired(c.env);
  const e = await c.env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(c.req.param("code").toUpperCase())
    .first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  const d = await detail(c.env, e);
  const showAttendance = e.status === "finalized" || e.status === "settled";
  return c.json<PublicEvent>({
    ...d,
    roster: d.roster.map((r) => ({ name: r.name, isFriend: r.friendIndex > 0, attended: r.attended })),
    showAttendance,
  });
});

publicRoutes.post("/join", async (c) => {
  const body = await readJson(c.req.raw);
  // Honeypot: real people never see this field, bots fill it in.
  if (str(body.website)) return c.json({ ok: true });
  const m = await createMember(c.env, {
    username: str(body.username),
    wechatNickname: str(body.wechatNickname),
    status: "pending",
  });
  return c.json({ ok: true, id: m.id });
});

/** First-time setup: only available while no admin link exists. */
publicRoutes.get("/admin-setup", async (c) => c.json({ needed: !(await adminLinkExists(c.env)) }));

publicRoutes.post("/admin-setup", async (c) => {
  if (await adminLinkExists(c.env)) throw new HttpError(409, "already_set_up", "管理链接已经设置过了");
  const body = await readJson(c.req.raw);
  if (!(await checkPassword(c.env, str(body.password)))) throw new HttpError(401, "wrong_password", "密码不正确");

  const origin = new URL(c.req.url).origin;
  const owner = await c.env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>();
  let ownerLink: string | null = null;
  if (!owner) {
    const m = await createMember(c.env, {
      username: str(body.username),
      wechatNickname: str(body.wechatNickname),
      status: "active",
      isOwner: true,
    });
    ownerLink = memberLink(origin, await issueMemberToken(c.env, m.id));
  }
  const adminToken = await issueAdminToken(c.env);
  await startSession(c);
  return c.json({ adminLink: `${origin}/admin/${adminToken}`, ownerLink });
});
