import { Hono } from "hono";
import { calendarEntry, icsFile } from "../../shared/calendar";
import type { HomeResponse, PublicEvent } from "../../shared/types";
import { summaries, type EventRow } from "../events";
import { getSettings } from "../db";
import { adminLinkExists, checkPassword, issueAdminToken, startSession } from "../auth";
import type { Env } from "../env";
import { HttpError, badRequest, readJson, str } from "../http";
import { checkEmail } from "../../shared/rules";
import { isStaging, siteTheme, siteTitle } from "../site";
import { leaderboard } from "../stats";
import { createMember } from "../members";
import { sendLinkRecovery } from "../approvalEmail";
import { applyToJoin, autoJoinEnabled } from "../joining";
import { turnstileSiteKey, verifyTurnstile } from "../turnstile";

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/site", async (c) =>
  c.json({
    title: await siteTitle(c.env),
    theme: await siteTheme(c.env),
    staging: isStaging(c.env),
    // The site's own icon colour (sites.json "icon"), for the logo in the top bar.
    icon: c.env.SITE_ICON || null,
    turnstileSiteKey: turnstileSiteKey(c.env),
    // 入群不需要审核: the join pages leave out 「审核通过后」.
    autoJoin: await autoJoinEnabled(c.env),
    sponsor: c.env.SPONSOR_NAME ? { name: c.env.SPONSOR_NAME, url: c.env.SPONSOR_URL || null } : null,
  }),
);

publicRoutes.get("/home", async (c) => {
  const current = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('open', 'closed', 'finalized') ORDER BY start_at",
  ).all<EventRow>();
  const past = await c.env.DB.prepare(
    "SELECT * FROM events WHERE status IN ('settled', 'cancelled') ORDER BY start_at DESC LIMIT 20",
  ).all<EventRow>();
  return c.json<HomeResponse>({
    currentEvents: await summaries(c.env, current.results),
    pastEvents: await summaries(c.env, past.results),
    leaderboard:
      (await getSettings(c.env.DB, ["show_leaderboard"])).show_leaderboard === "0" ? null : await leaderboard(c.env),
  });
});

publicRoutes.get("/events/:code", async (c) => {
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
  await verifyTurnstile(c.env, c.req.raw, str(body.turnstileToken), "join");
  // 用邮箱注册: the link is emailed on approval, so the address must be typed twice and match.
  const email = str(body.email).trim();
  if (email.toLowerCase() !== str(body.emailConfirm).trim().toLowerCase()) throw badRequest("两次输入的邮箱不一致");
  const { member, approved, emailStatus } = await applyToJoin(c.env, {
    username: str(body.username),
    wechatNickname: str(body.wechatNickname),
    message: str(body.message),
    email,
  });
  return c.json({ ok: true, id: member.id, approved, emailStatus });
});

/**
 * 找回我的专属链接. Always the same answer, whether or not the address belongs to a member, so it
 * can't be used to find out who is in the group; at most one email an hour per member.
 */
publicRoutes.post("/recover-link", async (c) => {
  const body = await readJson(c.req.raw);
  if (str(body.website)) return c.json({ ok: true });
  await verifyTurnstile(c.env, c.req.raw, str(body.turnstileToken), "recover_link");
  const err = checkEmail(str(body.email));
  if (err) throw badRequest(err);
  try {
    await sendLinkRecovery(c.env, str(body.email));
  } catch (err) {
    // Same answer either way: an error only for members' addresses would tell who is one.
    console.error("link recovery failed:", err);
  }
  return c.json({ ok: true });
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
