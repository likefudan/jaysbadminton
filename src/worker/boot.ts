import type { Context } from "hono";
import type { Env } from "./env";
import { sessionInfo } from "./googleAuth";
import { siteInfo } from "./routes/public";

/**
 * What every page asks for first, written into the page itself: the site's name and theme and who is
 * signed in. The page would otherwise wait for its script, then ask, then draw (src/web/api.ts reads
 * this). The keys are the API addresses whose answers these are.
 */
export const BOOT_ID = "boot";

/** A request header for a page without it: the browser tests that answer those addresses themselves. */
export const PLAIN_PAGE_HEADER = "X-Plain-Page";

export async function withBoot<E extends { Bindings: Env }>(c: Context<E>, page: Response): Promise<Response> {
  if (c.req.header(PLAIN_PAGE_HEADER) || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html"))
    return page;
  let json: string;
  try {
    const [site, session] = await Promise.all([siteInfo(c.env), sessionInfo(c)]);
    json = JSON.stringify({ "/api/public/site": site, "/api/auth/session": session });
  } catch (err) {
    // The page still works without it: it asks as before.
    console.error("boot data failed:", err);
    return page;
  }
  // Never a closing tag or a comment opener inside the script element.
  const safe = json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(`<script type="application/json" id="${BOOT_ID}">${safe}</script>`, { html: true });
      },
    })
    .transform(page);
}
