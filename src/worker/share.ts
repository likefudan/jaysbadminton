import { formatDateZh, formatInstantZh } from "../shared/time";
import type { Env } from "./env";
import { summaries, type EventRow } from "./events";
import { isStaging, siteTitle } from "./site";

/**
 * Link previews. WeChat, iMessage and Telegram read the page's <title>, description and og:*
 * tags without running any script, so the Worker fills them in for the home page and for each
 * event page before handing back the usual single-page app.
 */
export interface ShareMeta {
  title: string;
  description: string;
  url: string;
}

const TAGLINE = "报名、结算、付款，一个链接搞定。";

export async function homeMeta(env: Env): Promise<ShareMeta> {
  return { title: await siteTitle(env), description: TAGLINE, url: `${env.SITE_ORIGIN}/` };
}

/** "HappyTuesday 比赛 · 10月6日 周二" / "19:00–21:00 · Bay Badminton Center · 已报名 8 人 · 截止 …". */
export async function eventMeta(env: Env, code: string): Promise<ShareMeta | null> {
  const row = await env.DB.prepare("SELECT * FROM events WHERE code = ? ORDER BY start_at DESC LIMIT 1")
    .bind(code.toUpperCase())
    .first<EventRow>();
  if (!row) return null;
  const [e] = await summaries(env, [row]);
  const date = formatDateZh(e!.date);
  const parts = [`${e!.startTime}–${e!.endTime}`, e!.location, `已报名 ${e!.headcount} 人`];
  if (e!.status === "open") parts.push(`报名截止 ${formatInstantZh(e!.deadlineAt)}`);
  if (e!.status === "cancelled") parts.unshift("已取消");
  return {
    title: `${e!.title ? `${e!.title} · ` : ""}${date} 羽毛球 · ${await siteTitle(env)}`,
    description: parts.join(" · "),
    url: `${env.SITE_ORIGIN}/e/${e!.code}`,
  };
}

/** Rewrites the app's index.html with the given preview tags. */
export function withShareMeta(page: Response, meta: ShareMeta, origin: string, staging = false): Response {
  if (staging) meta = { ...meta, title: `【测试】${meta.title}` };
  const set = (value: string) => ({
    element(el: Element) {
      el.setAttribute("content", value);
    },
  });
  const image = `${origin}/og-image.jpg`;
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', set(meta.description))
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[property="og:image"]', set(image))
    .on("head", {
      element(el) {
        el.append(`<meta property="og:url" content="${escapeAttr(meta.url)}" />`, { html: true });
      },
    })
    .transform(page);
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The app shell from the static assets, with preview tags for this URL. */
export async function sharePage(env: Env, request: Request, meta: ShareMeta | null): Promise<Response> {
  const url = new URL(request.url);
  // No conditional headers: a 304 would hand back a cached page without these tags.
  const page = await env.ASSETS.fetch(new Request(`${url.origin}/`));
  if (!meta || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return page;
  return withShareMeta(page, meta, env.SITE_ORIGIN, isStaging(env));
}
