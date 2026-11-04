import type { Env } from "./env";
import { HttpError } from "./http";

/**
 * Cloudflare Turnstile (人机验证) on the public form anyone can submit: 找回我的专属链接 (申请加入 is Google only now).
 * The site key is a public var in wrangler.jsonc; the secret is pushed from the GitHub secret
 * TURNSTILE_SECRET on deploy. Until that secret is there (and in tests and local dev), the forms
 * show no widget and nothing is checked; once it is, every submission needs a passing token.
 */
export type TurnstileAction = "recover_link";

export const turnstileEnabled = (env: Env) => !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);

/** The site key for the pages, or null while Turnstile is off. */
export const turnstileSiteKey = (env: Env) => (turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY! : null);

const failed = () => new HttpError(403, "turnstile_failed", "人机验证没有通过，请重新验证后再提交");

/**
 * Redeems the browser's token at Siteverify. It must pass, be for this form, and come from this
 * deployment's own hostname (SITE_ORIGIN), so a token solved on the test site or on localhost is
 * refused here. Tokens are single-use: a replay fails at Siteverify.
 */
export async function verifyTurnstile(env: Env, req: Request, token: string, action: TurnstileAction): Promise<void> {
  if (!turnstileEnabled(env)) return;
  if (!token || token.length > 2048) throw failed();
  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET!,
        response: token,
        remoteip: req.headers.get("CF-Connecting-IP") ?? "",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = await res.json();
  } catch (err) {
    console.error("turnstile siteverify failed:", String(err));
    throw failed();
  }
  if (result.success !== true || result.action !== action || result.hostname !== new URL(env.SITE_ORIGIN).hostname)
    throw failed();
}
