import { type Context, Hono } from "hono";
import { calendarEntry, icsFile } from "../../shared/calendar";
import type { EventSummary, HomeResponse, PublicEvent } from "../../shared/types";
import { summaries, type EventRow } from "../events";
import { adminLinkExists, checkPassword, issueAdminToken, startSession } from "../auth";
import type { Env } from "../env";
import { HttpError, readJson, str } from "../http";
import { appNames, isStaging, siteTheme } from "../site";
import { boardSettings, leaderboard, onlyBoards } from "../stats";
import { signedInMember } from "../googleAuth";
import { readAvatar } from "../avatars";
import { createMember } from "../members";
import { autoJoinEnabled } from "../joining";

export const publicRoutes = new Hono<{ Bindings: Env }>();

/** The site's name, theme and the like: /api/public/site, and written into every page (boot.ts). */
export async function siteInfo(env: Env) {
  const [{ names, title }, theme, autoJoin] = await Promise.all([appNames(env), siteTheme(env), autoJoinEnabled(env)]);
  return {
    title,
    // 桌面图标名称 as set, by language: the page picks the visitor's (iPhone offers it when adding).
    appNames: names,
    theme,
    staging: isStaging(env),
    // The site's own icon colour (sites.json "icon"), for the logo in the top bar.
    icon: env.SITE_ICON || null,
    // 入群不需要审核: the join pages leave out 「审核通过后」.
    autoJoin,
    sponsor: env.SPONSOR_NAME ? { name: env.SPONSOR_NAME, url: env.SPONSOR_URL || null } : null,
  };
}

publicRoutes.get("/site", async (c) => c.json(await siteInfo(c.env)));

publicRoutes.get("/home", async (c) => {
  // Side by side: each is its own trip to the database.
  const [[current, past], leaderboard] = await Promise.all([
    c.env.DB.batch<EventRow>([
      c.env.DB.prepare("SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at"),
      c.env.DB.prepare("SELECT * FROM events WHERE status IN ('settled', 'cancelled') ORDER BY start_at DESC LIMIT 20"),
    ]),
    publicBoard(c),
  ]);
  const [currentEvents, pastEvents] = await Promise.all([forViewer(c, current!.results), forViewer(c, past!.results)]);
  return c.json<HomeResponse>({ currentEvents, pastEvents, leaderboard });
});

/**
 * Events as whoever is asking may see them: a visitor who isn't signed in gets when, which venue and
 * how many, but not the street address or the organizer's notes (court numbers, where to meet),
 * which are for the group.
 */
async function forViewer(c: Context<{ Bindings: Env }>, rows: EventRow[]): Promise<EventSummary[]> {
  const [list, member] = await Promise.all([summaries(c.env, rows), signedInMember(c)]);
  return member ? list : list.map((e) => ({ ...e, address: "", notes: "" }));
}

/**
 * 首页排行榜: the boards the Owner or an admin made public, to signed-in members only unless
 * 没登录也能看 is on (Ke Li 2026-11-10: names stay inside the group by default).
 */
async function publicBoard(c: Context<{ Bindings: Env }>) {
  const s = await boardSettings(c.env);
  if (s.public.length === 0) return null;
  const member = await signedInMember(c);
  if (!s.anon && !member) return null;
  // Faces stay inside the group: visitors who aren't signed in see the names only.
  return onlyBoards(await leaderboard(c.env, { avatars: !!member }), s.public);
}

/** 头像: a member's own photo, under a random id that changes on every upload. */
publicRoutes.get("/avatars/:id", async (c) => {
  const image = await readAvatar(c.env, c.req.param("id"));
  if (!image) throw new HttpError(404, "not_found", "找不到这个头像");
  return c.body(image, 200, { "Content-Type": "image/jpeg" });
});

publicRoutes.get("/events/:code", async (c) => {
  const e = await c.env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(c.req.param("code").toUpperCase())
    .first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  // Public: the head count only, never who signed up.
  const [summary] = await forViewer(c, [e]);
  return c.json<PublicEvent>(summary!);
});

/** 加入日历: the event as an .ics file; iPhone opens it straight into Calendar. */
publicRoutes.get("/events/:code/calendar.ics", async (c) => {
  const e = await c.env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(c.req.param("code").toUpperCase())
    .first<EventRow>();
  if (!e) throw new HttpError(404, "event_not_found", "找不到这个活动");
  const [summary] = await forViewer(c, [e]);
  return c.body(icsFile(calendarEntry(summary!, c.env.SITE_ORIGIN)), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="badminton-${e.date}.ics"`,
  });
});

/**
 * 用邮箱注册 is gone (Ke Li 2026-11-04): new members join with Google only, so nobody new gets a
 * /m/ link. Members who already have one keep it, and 找回我的专属链接 still mails it to them.
 */
publicRoutes.post("/join", () => {
  throw new HttpError(410, "google_only", "新成员请用 Google 登录申请入群");
});

/** 找回我的专属链接 is off too (Ke Li 2026-11-04): 专属链接 are going away, so none is mailed out again. */
publicRoutes.post("/recover-link", () => {
  throw new HttpError(410, "google_only", "专属链接已停止找回，请用 Google 登录");
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
