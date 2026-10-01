import { Hono } from "hono";
import { adminLinkExists, checkPassword, issueAdminToken, startSession } from "../auth";
import type { Env } from "../env";
import { HttpError, readJson, str } from "../http";
import { createMember, issueMemberToken, memberLink } from "../members";

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/home", (c) => c.json({ openEvents: [], pastEvents: [], leaderboard: [] }));

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
