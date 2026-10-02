import { Hono } from "hono";
import { calendarEntry, icsFile } from "../../shared/calendar";
import type { HomeResponse, PublicEvent } from "../../shared/types";
import { closeExpired, summaries, type EventRow } from "../events";
import { getSettings } from "../db";
import { adminLinkExists, checkPassword, issueAdminToken, startSession } from "../auth";
import type { Env } from "../env";
import { HttpError, readJson, str } from "../http";
import { isStaging, siteTheme, siteTitle } from "../site";
import { leaderboard } from "../stats";
import { assertPendingRoom, createMember } from "../members";

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/site", async (c) =>
  c.json({ title: await siteTitle(c.env), theme: await siteTheme(c.env), staging: isStaging(c.env) }),
);

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
    leaderboard: (await getSettings(c.env.DB, ["show_leaderboard"])).show_leaderboard === "0" ? null : await leaderboard(c.env),
  });
});

publicRoutes.get("/events/:code", async (c) => {
  await closeExpired(c.env);
  const e = await c.env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(c.req.param("code").toUpperCase())
    .first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  // Public: the head count only, never who signed up.
  const [summary] = await summaries(c.env, [e]);
  return c.json<PublicEvent>(summary!);
});

/** 加入日历: the event as an .ics file; iPhone opens it straight into Calendar. */
publicRoutes.get("/events/:code/calendar.ics", async (c) => {
  const e = await c.env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(c.req.param("code").toUpperCase())
    .first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  const [summary] = await summaries(c.env, [e]);
  return c.body(icsFile(calendarEntry(summary!, c.env.SITE_ORIGIN)), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="badminton-${e.date}.ics"`,
  });
});

publicRoutes.post("/join", async (c) => {
  const body = await readJson(c.req.raw);
  // Honeypot: real people never see this field, bots fill it in.
  if (str(body.website)) return c.json({ ok: true });
  await assertPendingRoom(c.env);
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
  // The Owner is also a player (on rosters and bills), but signs up from the admin page, so they
  // get no member link of their own: the admin link is the only one to keep.
  const owner = await c.env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>();
  if (!owner) {
    await createMember(c.env, {
      username: str(body.username),
      wechatNickname: str(body.wechatNickname),
      status: "active",
      isOwner: true,
    });
  }
  const adminToken = await issueAdminToken(c.env);
  await startSession(c);
  return c.json({ adminLink: `${origin}/admin/${adminToken}` });
});
