// 发布管理网站 (badminton.llmat.dev). Anyone may sign in with Google and apply; Ke Li (the owner,
// OPS_EMAIL) approves them as viewers or release engineers (users.ts). Viewers see the page; only the
// owner and release engineers may release, roll back or restore. The page (page.ts, app.js) reads
// /api/state and asks /api/release to start the Release workflow, which backs up, migrates and deploys
// the chosen sites exactly as when it is run by hand in GitHub.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { forget, MainMoved, release, releaseList, restore, state } from "./github";
import { type Env, pickSites, randomToken, sha256, sign, sites, TAG, unsign } from "./logic";
import { isLang, LANG_COOKIE, type Lang, langOf, tr } from "./i18n";
import { APP_CSS, APP_JS, page } from "./page";
import { DurableObject } from "cloudflare:workers";
import { canRelease, type Role, roleOf, type Status, type User, UserBook } from "./users";

const SESSION = "__Host-ops";
const OAUTH = "__Host-ops-oauth";
const DAY = 86400;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const SECURITY = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // same-origin, not no-referrer: with no-referrer browsers send "Origin: null" on form posts (/apply,
  // /logout), which the origin check below would refuse. Nothing leaks to other sites either way.
  "Referrer-Policy": "same-origin",
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

const owner = (env: Env) => env.OPS_EMAIL!.trim().toLowerCase();
const book = (env: Env) => env.USERS.get(env.USERS.idFromName("users"));
// Emails go into the signed cookie as they are, so only plain ones (Google's always are).
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+$/;

interface Me {
  email: string;
  role: Role | null;
  user: User | null;
}

/** Who is signed in and what they may do now (read afresh every time, so a change is immediate). */
async function who(req: Request, env: Env): Promise<Me | null> {
  if (!env.OPS_SESSION_KEY || !env.OPS_EMAIL) return null;
  const email = await unsign(env.OPS_SESSION_KEY, readCookie(req, SESSION));
  if (!email || !EMAIL.test(email)) return null;
  const user = email === owner(env) ? null : await book(env).get(email);
  return { email, role: roleOf(email, env.OPS_EMAIL, user), user };
}

/** How a signed-in person is named in notices and logs. */
const label = (env: Env, me: Me) => (me.role === "owner" ? env.OWNER_NAME : me.user?.name || me.email);
const ROLE_NAME: Record<Role, string> = { owner: "管理者", engineer: "发布工程师", viewer: "只读" };

function ready(env: Env, lang: Lang): string | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return tr(lang, "还没有 Google 登录的设置（GOOGLE_CLIENT_ID）");
  if (!env.OPS_EMAIL) return tr(lang, "还没有设置管理者的邮箱（GitHub secret OPS_EMAIL）");
  if (!env.OPS_SESSION_KEY) return tr(lang, "还没有登录密钥（下次部署时自动生成）");
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
    if (payload.nonce !== nonce) return redirect("/?error=login", [clear]);
    if (payload.email_verified !== true || !EMAIL.test(email)) return redirect("/?error=account", [clear]);
    // Anyone may sign in; only approved accounts see more than the application form. The developers'
    // group hears of approved sign-ins here and of applications when they are sent.
    const user = email === owner(env) ? null : await book(env).get(email);
    const role = roleOf(email, env.OPS_EMAIL, user);
    if (role)
      ctx.waitUntil(
        notifyDev(
          env,
          `🔑 ${label(env, { email, role, user })}（${ROLE_NAME[role]}）登录了发布管理网站（${from(req)}）`,
        ),
      );
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
    const lang = langOf(req);
    // The 文A menu's links: remember the language for a year and go back to the page.
    const to = path.match(/^\/lang\/([\w-]+)$/)?.[1];
    if (to && req.method === "GET")
      return redirect(
        "/",
        isLang(to) ? [`${LANG_COOKIE}=${to}; Path=/; Max-Age=${365 * DAY}; Secure; SameSite=Lax`] : [],
      );

    // Changes come only from this site's own page.
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("Origin") !== env.OPS_ORIGIN)
      return json({ error: tr(lang, "来源不对") }, 403);

    const problem = ready(env, lang);
    if (path === "/login") return problem ? redirect("/") : startLogin(env);
    if (path === "/auth/callback") return problem ? redirect("/") : finishLogin(req, env, ctx);
    if (path === "/logout" && req.method === "POST") return redirect("/", [cookie(SESSION, "", 0)]);

    const me = problem ? null : await who(req, env);
    if (path === "/")
      return respond(
        page({
          email: me?.email ?? null,
          role: me?.role ?? null,
          user: me?.user ?? null,
          owner: env.OWNER_NAME,
          problem,
          error: url.searchParams.get("error"),
          lang,
        }),
        { type: "text/html; charset=utf-8" },
      );
    if (!me) return path === "/apply" ? redirect("/") : json({ error: tr(lang, "请先登录") }, 401);
    const email = me.email;

    // The application form (server-drawn, no script): a new account, or a waiting one changing its note.
    if (path === "/apply" && req.method === "POST") {
      if (me.role) return redirect("/");
      const form = await req.formData().catch(() => null);
      const name = form?.get("name");
      if (typeof name !== "string" || !name.trim()) return redirect("/?error=name");
      const done = await book(env).apply(email, name, typeof form?.get("note") === "string" ? form.get("note") : "");
      if (!done.ok) return redirect(`/?error=${done.reason}`);
      if (done.isNew) {
        console.log(`ops: ${email} applied`);
        const u = done.user;
        ctx.waitUntil(
          notifyDev(
            env,
            `📝 ${u.name}（${u.email}）申请使用发布管理网站${u.note ? `：${u.note}` : ""}\n请到 ${env.OPS_ORIGIN} 审核`,
          ),
        );
      }
      return redirect("/");
    }
    if (!me.role) return json({ error: tr(lang, "还没有批准") }, 403);

    // The owner's list of accounts and her decisions on them.
    if (path === "/api/users") {
      if (me.role !== "owner")
        return json({ error: tr(lang, "只有 {name} 可以管理用户", { name: env.OWNER_NAME }) }, 403);
      if (req.method === "GET") return json({ users: await book(env).list() });
      if (req.method === "POST") {
        const body = (await req.json().catch(() => null)) as { email?: unknown; action?: unknown } | null;
        const target = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const action = body?.action;
        if (!EMAIL.test(target) || target === owner(env)) return json({ error: tr(lang, "找不到这个用户") }, 400);
        if (action === "remove") await book(env).remove(target);
        else if (action === "viewer" || action === "engineer" || action === "rejected") {
          if (!(await book(env).decide(target, action))) return json({ error: tr(lang, "找不到这个用户") }, 404);
        } else return json({ error: tr(lang, "操作不对") }, 400);
        console.log(`ops: ${email} set ${target} to ${action}`);
        return json({ users: await book(env).list() });
      }
    }
    if (!env.OPS_GITHUB_TOKEN)
      return json({ error: tr(lang, "还没有设置 GitHub 令牌（GitHub secret OPS_GITHUB_TOKEN）") }, 503);

    if (path === "/api/state" && req.method === "GET") {
      try {
        const waiting = me.role === "owner" ? (await book(env).list()).filter((u) => u.status === "pending").length : 0;
        return json({ ...(await state(env)), me: { email, role: me.role, name: label(env, me) }, waiting });
      } catch (err) {
        console.error("ops state failed:", err);
        return json({ error: tr(lang, "读取失败：{msg}", { msg: (err as Error).message }) }, 502);
      }
    }
    if (path === "/api/releases" && req.method === "GET") {
      const n = Number(url.searchParams.get("page") ?? "1");
      if (!Number.isInteger(n) || n < 1 || n > 50) return json({ error: tr(lang, "页码不对") }, 400);
      try {
        return json(await releaseList(env, n));
      } catch (err) {
        console.error("ops releases failed:", err);
        return json({ error: tr(lang, "读取失败：{msg}", { msg: (err as Error).message }) }, 502);
      }
    }
    // Only the owner and release engineers change what the sites run.
    if ((path === "/api/restore" || path === "/api/release") && !canRelease(me.role))
      return json({ error: tr(lang, "只有发布工程师可以发布、回滚和恢复") }, 403);
    if (path === "/api/restore" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { site?: unknown; tag?: unknown; confirm?: unknown } | null;
      const site = sites(env).find((x) => x.id === body?.site);
      const tag = body?.tag;
      if (!site) return json({ error: tr(lang, "请选择站点") }, 400);
      if (typeof tag !== "string" || !TAG.test(tag)) return json({ error: tr(lang, "版本不对") }, 400);
      if (body?.confirm !== site.id) return json({ error: tr(lang, "请输入 {id} 确认", { id: site.id }) }, 400);
      try {
        await restore(env, site.id, tag);
        forget();
        console.log(`ops: ${email} restored ${site.id} for ${tag}`);
        ctx.waitUntil(
          notifyDev(
            env,
            `⏪ ${label(env, me)} 从发布管理网站开始恢复备份：${site.name} 的数据库回到迁移之前，再换到 ${tag}\n${env.OPS_ORIGIN}`,
          ),
        );
        return json({ ok: true });
      } catch (err) {
        console.error("ops restore failed:", err);
        return json({ error: tr(lang, "没能开始恢复：{msg}", { msg: (err as Error).message }) }, 502);
      }
    }
    if (path === "/api/release" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { sites?: unknown; tag?: unknown; main?: unknown } | null;
      const chosen = pickSites(body?.sites, sites(env));
      const tag = body?.tag ?? null;
      const main = body?.main;
      if (!chosen) return json({ error: tr(lang, "请选择站点") }, 400);
      if (tag !== null && (typeof tag !== "string" || !TAG.test(tag)))
        return json({ error: tr(lang, "版本不对") }, 400);
      // A new version names the commit the page listed the changes of.
      if (tag === null && (typeof main !== "string" || !/^[0-9a-f]{40}$/.test(main)))
        return json({ error: tr(lang, "请刷新页面再试") }, 400);
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
            `🚀 ${label(env, me)} 从发布管理网站开始发布：${tag ? `把 ${tag} ` : "从 main 打新版本并"}发到 ${names}\n${env.OPS_ORIGIN}`,
          ),
        );
        return json({ ok: true });
      } catch (err) {
        if (err instanceof MainMoved) {
          forget();
          return json({ error: tr(lang, "main 上有了新的改动，页面已经刷新，请看过再发布"), moved: true }, 409);
        }
        console.error("ops release failed:", err);
        return json({ error: tr(lang, "没能开始发布：{msg}", { msg: (err as Error).message }) }, 502);
      }
    }
    return json({ error: tr(lang, "找不到这个地址") }, 404);
  },
} satisfies ExportedHandler<Env>;

/** The one Durable Object holding the list (its built-in storage, nothing to set up). */
export class OpsUsers extends DurableObject {
  private book = new UserBook(this.ctx.storage);
  get(email: string) {
    return this.book.get(email);
  }
  list() {
    return this.book.list();
  }
  apply(email: string, name: unknown, note: unknown) {
    return this.book.apply(email, name, note);
  }
  decide(email: string, status: Exclude<Status, "pending">) {
    return this.book.decide(email, status);
  }
  remove(email: string) {
    return this.book.remove(email);
  }
}
