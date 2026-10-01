import { Hono } from "hono";
import type { Env } from "./env";
import { HttpError } from "./http";
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
  async scheduled(_controller, _env, _ctx) {
    // Reminders, deadline closing and dunning land here in later cards.
  },
  async email(message, _env, _ctx) {
    // Venmo email ingestion lands here in card 5; until then drop everything.
    message.setReject("Not accepting mail yet");
  },
} satisfies ExportedHandler<Env>;
