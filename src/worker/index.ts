import { Hono } from "hono";
import type { Env } from "./env";
import { closeExpired } from "./events";
import { HttpError } from "./http";
import { MAX_EMAIL_BYTES, handleEmail } from "./inbound";
import { adminRoutes } from "./routes/admin";
import { memberRoutes } from "./routes/member";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  // Member and admin links carry secret tokens in the path; keep them out of caches and referrers.
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
});

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM members").first<{ n: number }>();
  return c.json({ ok: true, members: row?.n ?? 0 });
});

app.route("/api/public", publicRoutes);
app.route("/api/m", memberRoutes);
app.route("/api/admin", adminRoutes);

app.notFound((c) => c.json({ error: { code: "not_found", message: "找不到这个地址" } }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  console.error(err);
  return c.json({ error: { code: "internal", message: "服务器出错了，请稍后再试" } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, _ctx) {
    await closeExpired(env);
    // Reminders and dunning land here in card 6.
  },
  async email(message, env, _ctx) {
    // Never bounce or throw: a bounce would land in the Owner's Gmail for every non-receipt.
    try {
      if (message.rawSize > MAX_EMAIL_BYTES) {
        console.warn("email too large:", message.rawSize);
        return;
      }
      const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
      console.log("email:", await handleEmail(env, raw));
    } catch (err) {
      console.error("email handler failed:", err);
    }
  },
} satisfies ExportedHandler<Env>;
