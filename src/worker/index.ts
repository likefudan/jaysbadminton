import { developerRoutes } from "./developer";
import { Hono } from "hono";
import type { Env } from "./env";
import { closeExpired } from "./events";
import { endDueNoFeeEvents } from "./noFee";
import { syncAllDeadlines } from "./deadlines";
export { DeadlineAlarm } from "./deadlines";
export { PushSender } from "./push";
import { HttpError, readJson } from "./http";
import {
  MAX_EMAIL_BYTES,
  purgeDeletedInbound,
  purgeGmailConfirmations,
  receiveEmail,
  recordEmailOutcome,
} from "./inbound";
import { exportAll } from "./export";
import { remindExpiredPayees } from "./appointments";
import { emailProblemAlert, pruneEmailLog, recordCronError } from "./health";
import { runScheduled } from "./notify";
import { eventMeta, homeMeta, sharePage } from "./share";
import { isStaging, siteTitle } from "./site";
import { SECURITY_HEADERS } from "../shared/security";
import { checkExportKey } from "./sheets";
import { handleUpdate, upgradeCommands, upgradeWebhookSecret, webhookSecret } from "./telegram";
import { adminRoutes } from "./routes/admin";
import { memberRoutes } from "./routes/member";
import { publicRoutes } from "./routes/public";
import { googleRoutes } from "./googleAuth";
import { diagnoseOversizedEmail, purgePaymentDiagnostics } from "./paymentDiagnostics";
import { purgeCourtPhotos } from "./courtPhoto";
import { sendReleaseNotices } from "./releaseNotice";
import { saveUpload } from "./calories";

// A site with its own icon colour (sites.json "icon") gets its icons from public/site-icons/<colour>/,
// under the usual names, so the home-screen app, tab, share card and link previews all match.
// site-config.mjs routes the files in that folder through the Worker, and only on such a site.
const SITE_ICON_FILES = [
  "/favicon.svg",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/og-image.jpg",
];

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  // Member and admin links carry secret tokens in the path; keep them out of caches. The icons have none.
  c.header("Cache-Control", SITE_ICON_FILES.includes(c.req.path) ? "public, max-age=3600" : "no-store");
  // Same as public/_headers, now that the Worker also serves the home and event pages.
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  if (isStaging(c.env)) c.header("X-Robots-Tag", "noindex, nofollow");
});

// The icons in this site's colour, when it has its own.
for (const file of SITE_ICON_FILES)
  app.get(file, async (c) => {
    const icon = c.env.SITE_ICON;
    const path = icon && /^[a-z0-9-]+$/.test(icon) ? `/site-icons/${icon}${file}` : file;
    const res = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
    return new Response(res.body, res);
  });

// Proves the Worker can reach the migrated database; says nothing about the group itself.
app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1 FROM members LIMIT 1").first();
  return c.json({ ok: true });
});

// Browsers report what the content policy would have blocked; read them in the Worker logs.
app.post("/api/csp-report", async (c) => {
  // Only the start is logged, so only the start is read: anyone can post here. Bytes, not text():
  // the body is application/csp-report, which text() warns about.
  const reader = c.req.raw.body?.getReader();
  const bytes = new Uint8Array(2000);
  let n = 0;
  try {
    while (reader && n < bytes.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, bytes.length - n);
      bytes.set(part, n);
      n += part.length;
    }
    await reader?.cancel();
  } catch {
    // The sender went away mid-report: log what arrived.
  }
  const report = new TextDecoder().decode(bytes.subarray(0, n));
  console.warn("csp report:", report);
  return c.body(null, 204);
});

// Telegram delivers bot messages here; only the binding code in "/start <code>" is acted on.
app.post("/api/telegram/webhook", async (c) => {
  if (c.req.header("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(c.env)))
    return c.json({ ok: false }, 403);
  try {
    await handleUpdate(c.env, await c.req.json());
  } catch (err) {
    console.error("telegram update failed:", err);
  }
  return c.json({ ok: true });
});

// CI calls this after a production release has deployed (scripts/release-notice.mjs). It takes
// nothing: it only sends the notices CI recorded in the database, each once, so anyone may call it.
app.post("/api/release-notice", async (c) => c.json({ sent: await sendReleaseNotices(c.env) }));

// The 卡路里 Shortcut posts the number here with the one-time code from 读取; no cookie, no origin.
app.post("/api/calories/:code", async (c) => {
  const body = await readJson(c.req.raw);
  return c.json({ ok: true, kcal: await saveUpload(c.env, c.req.param("code"), body.kcal, body.v) });
});

// Pulled once a day by the Apps Script in the Owner's Google Sheet; the key is the only credential.
app.get("/export/:key/all.json", async (c) => {
  if (!(await checkExportKey(c.env, c.req.param("key"))))
    return c.json({ error: { code: "invalid_key", message: "同步密钥无效" } }, 403);
  return c.json(await exportAll(c.env));
});

// Search engines may index the real site, never the test site.
app.get("/robots.txt", (c) =>
  c.text(
    isStaging(c.env)
      ? "User-agent: *\nDisallow: /\n"
      : "User-agent: *\nDisallow: /m/\nDisallow: /admin\nDisallow: /api/\n",
  ),
);

// The home-screen app is named after this site, as every site deployed from this code has its own name.
app.get("/manifest.webmanifest", async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/manifest.webmanifest", c.req.url)));
  if (!res.ok) return res;
  const manifest = await res.json<Record<string, unknown>>();
  manifest.name = await siteTitle(c.env);
  return c.body(JSON.stringify(manifest), 200, { "Content-Type": "application/manifest+json" });
});

// Link previews for WeChat and friends: the app shell with this page's title and summary.
app.get("/", async (c) => sharePage(c.env, c.req.raw, await homeMeta(c.env)));
app.get("/e/:code", async (c) => sharePage(c.env, c.req.raw, await eventMeta(c.env, c.req.param("code"))));

app.route("/api/developer", developerRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/auth", googleRoutes);
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
    // Independent of the rest of cron and the opt-in switch: other job failures must not
    // prevent diagnostic data from expiring.
    try {
      await purgePaymentDiagnostics(env);
    } catch (err) {
      console.error("payment diagnostic cleanup failed:", err);
    }
    try {
      await purgeCourtPhotos(env); // 拍照登记 photos after 7 days
    } catch (err) {
      console.error("court photo cleanup failed:", err);
    }
    try {
      await endDueNoFeeEvents(env); // 无需收款 events an hour past their end go to history
    } catch (err) {
      console.error("ending 无需收款 events failed:", err);
      await recordCronError(env, err);
    }
    try {
      await closeExpired(env);
      // Re-aims every open event's alarm, so events created before alarms existed (or whose
      // sync failed) still get theirs.
      await syncAllDeadlines(env);
      await runScheduled(env);
      await purgeDeletedInbound(env); // 已删除 Venmo payments older than 30 days
      await purgeGmailConfirmations(env); // organizers' Gmail confirmation codes after 24 hours
      await remindExpiredPayees(env); // former organizers whose account no longer takes payments
      await pruneEmailLog(env);
      await upgradeWebhookSecret(env);
      await upgradeCommands(env); // /language in the bot menu of a bot set up before it
    } catch (err) {
      console.error("scheduled run failed:", err);
      await recordCronError(env, err);
    }
    // Last: it may wait on Claude, and the jobs above are on the clock.
    try {
      await sendReleaseNotices(env); // in case CI's call after a release didn't get through
    } catch (err) {
      console.error("release notice failed:", err);
    }
  },
  async email(message, env, _ctx) {
    // Never bounce or throw: a bounce would land in the Owner's Gmail for every non-receipt.
    try {
      if (message.rawSize > MAX_EMAIL_BYTES) {
        await diagnoseOversizedEmail(env, message.headers.get("From") ?? message.from);
        console.warn("email too large:", message.rawSize);
        return;
      }
      const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
      const { outcome, organizer } = await receiveEmail(env, raw);
      console.log("email:", outcome);
      await recordEmailOutcome(env, outcome, organizer);
      await emailProblemAlert(env, outcome, new Date(), organizer);
    } catch (err) {
      console.error("email handler failed:", err);
    }
  },
} satisfies ExportedHandler<Env>;
