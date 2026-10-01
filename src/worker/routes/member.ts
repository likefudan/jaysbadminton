import { Hono } from "hono";
import type { MeResponse } from "../../shared/types";
import type { Env } from "../env";
import { invalidLink, readJson, str } from "../http";
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
