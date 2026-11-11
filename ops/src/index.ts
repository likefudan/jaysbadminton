// 发布管理网站 (badminton.llmat.dev): only Ke Li's Google account gets in. The page (page.ts, app.js)
// reads /api/state and asks /api/release to start the Release workflow, which backs up, migrates and
// deploys the chosen sites exactly as when it is run by hand in GitHub.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { forget, MainMoved, release, releaseList, state } from "./github";
import { type Env, pickSites, randomToken, sha256, sign, sites, TAG, unsign } from "./logic";
import { APP_CSS, APP_JS, page } from "./page";

const SESSION = "__Host-ops";
const OAUTH = "__Host-ops-oauth";
const DAY = 86400;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const SECURITY = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function respond(body: BodyInit | null, init: ResponseInit & { type?: string } = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  if (init.type) headers.set("Content-Type", init.type);
  return new Response(body, { status: init.status ?? 200, headers });
}
const json = (data: unknown, status = 200) =>
  respond(JSON.stringify(data), { status, type: "application/json; charset=utf-8" });
const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return respond(null, { status: 302, headers });
};
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/** One message to the developers' Telegram group; never fails the request. */
async function notifyDev(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_DEV_BOT_TOKEN || !env.TELEGRAM_DEV_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_DEV_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_DEV_CHAT_ID,
        text,
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("ops: Telegram said", res.status);
  } catch (err) {
    console.error("ops: Telegram failed:", err);
  }
}

/** Where a request came from, for the sign-in notice: country and a short browser name. */
function from(req: Request): string {
  const country = (req as { cf?: { country?: string } }).cf?.country;
  const ua = req.headers.get("User-Agent") ?? "";
  const device = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "未知设备";
  return [device, country].filter(Boolean).join("，");
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("Cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (part.slice(0, i) === name) return part.slice(i + 1);
  }
  return undefined;
}

/** The signed-in email when it is still the allowed one. */
async function who(req: Request, env: Env): Promise<string | null> {
  if (!env.OPS_SESSION_KEY || !env.OPS_EMAIL) return null;
  const email = await unsign(env.OPS_SESSION_KEY, readCookie(req, SESSION));
  return email && email === env.OPS_EMAIL.trim().toLowerCase() ? email : null;
}

function ready(env: Env): string | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return "还没有 Google 登录的设置（GOOGLE_CLIENT_ID）";
  if (!env.OPS_EMAIL) return "还没有设置允许登录的邮箱（GitHub secret OPS_EMAIL）";
  if (!env.OPS_SESSION_KEY) return "还没有登录密钥（下次部署时自动生成）";
  return null;
}

async function startLogin(env: Env): Promise<Response> {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken() + randomToken();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.OPS_ORIGIN}/auth/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const saved = await sign(env.OPS_SESSION_KEY!, `${state}.${nonce}.${verifier}`, 600);
  return redirect(url.toString(), [cookie(OAUTH, saved, 600)]);
}

async function finishLogin(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const saved = await unsign(env.OPS_SESSION_KEY!, readCookie(req, OAUTH));
  const clear = cookie(OAUTH, "", 0);
  const [state, nonce, verifier] = saved?.split(".") ?? [];
  if (!state || !nonce || !verifier || q.get("state") !== state || !q.get("code"))
    return redirect("/?error=login", [clear]);
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.get("code")!,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${env.OPS_ORIGIN}/auth/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!res.ok || !id_token) throw new Error("token exchange failed");
    const { payload } = await jwtVerify(id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID!,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (payload.nonce !== nonce || payload.email_verified !== true || email !== env.OPS_EMAIL!.trim().toLowerCase()) {
      ctx.waitUntil(notifyDev(env, `⚠️ 有人用别的 Google 账号尝试登录发布管理网站（${from(req)}），没有放行`));
      return redirect("/?error=account", [clear]);
    }
    ctx.waitUntil(notifyDev(env, `🔑 发布管理网站有新的登录（${from(req)}）`));
    return redirect("/", [clear, cookie(SESSION, await sign(env.OPS_SESSION_KEY!, email, 7 * DAY), 7 * DAY)]);
  } catch (err) {
    console.error("ops login failed:", err);
    return redirect("/?error=login", [clear]);
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/app.js") return respond(APP_JS, { type: "text/javascript; charset=utf-8" });
    if (path === "/app.css") return respond(APP_CSS, { type: "text/css; charset=utf-8" });
    if (path === "/health") return json({ ok: true });

    // Changes come only from this site's own page.
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("Origin") !== env.OPS_ORIGIN)
      return json({ error: "来源不对" }, 403);

    const problem = ready(env);
    if (path === "/login") return problem ? redirect("/") : startLogin(env);
    if (path === "/auth/callback") return problem ? redirect("/") : finishLogin(req, env, ctx);
    if (path === "/logout" && req.method === "POST") return redirect("/", [cookie(SESSION, "", 0)]);

    const email = await who(req, env);
    if (path === "/")
      return respond(page({ email, problem, error: url.searchParams.get("error") }), {
        type: "text/html; charset=utf-8",
      });
    if (!email) return json({ error: "请先登录" }, 401);
    if (!env.OPS_GITHUB_TOKEN) return json({ error: "还没有设置 GitHub 令牌（GitHub secret OPS_GITHUB_TOKEN）" }, 503);

    if (path === "/api/state" && req.method === "GET") {
      try {
        return json(await state(env));
      } catch (err) {
        console.error("ops state failed:", err);
        return json({ error: `读取失败：${(err as Error).message}` }, 502);
      }
    }
    if (path === "/api/releases" && req.method === "GET") {
      const n = Number(url.searchParams.get("page") ?? "1");
      if (!Number.isInteger(n) || n < 1 || n > 50) return json({ error: "页码不对" }, 400);
      try {
        return json(await releaseList(env, n));
      } catch (err) {
        console.error("ops releases failed:", err);
        return json({ error: `读取失败：${(err as Error).message}` }, 502);
      }
    }
    if (path === "/api/release" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { sites?: unknown; tag?: unknown; main?: unknown } | null;
      const chosen = pickSites(body?.sites, sites(env));
      const tag = body?.tag ?? null;
      const main = body?.main;
      if (!chosen) return json({ error: "请选择站点" }, 400);
      if (tag !== null && (typeof tag !== "string" || !TAG.test(tag))) return json({ error: "版本不对" }, 400);
      // A new version names the commit the page listed the changes of.
      if (tag === null && (typeof main !== "string" || !/^[0-9a-f]{40}$/.test(main)))
        return json({ error: "请刷新页面再试" }, 400);
      try {
        await release(env, chosen, tag === null ? { expect: main as string } : { tag });
        forget();
        console.log(`ops: ${email} released ${tag ?? "a new version"} to ${chosen.join(",")}`);
        const names =
          chosen.length === sites(env).length
            ? "全部站点"
            : chosen.map((id) => sites(env).find((x) => x.id === id)?.name ?? id).join("、");
        ctx.waitUntil(
          notifyDev(
            env,
            `🚀 从发布管理网站开始发布：${tag ? `把 ${tag} ` : "从 main 打新版本并"}发到 ${names}\n${env.OPS_ORIGIN}`,
          ),
        );
        return json({ ok: true });
      } catch (err) {
        if (err instanceof MainMoved) {
          forget();
          return json({ error: "main 上有了新的改动，页面已经刷新，请看过再发布", moved: true }, 409);
        }
        console.error("ops release failed:", err);
        return json({ error: `没能开始发布：${(err as Error).message}` }, 502);
      }
    }
    return json({ error: "找不到这个地址" }, 404);
  },
} satisfies ExportedHandler<Env>;
