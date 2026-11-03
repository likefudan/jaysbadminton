import type { DeadlineAlarm } from "./deadlines";
import type { PushSender } from "./push";

export interface Env {
  DB: D1Database;
  /** One alarm per event for its reminder and deadline (see deadlines.ts). */
  DEADLINES: DurableObjectNamespace<DeadlineAlarm>;
  /** Sends a push backlog one batch a second (see push.ts). */
  PUSH: DurableObjectNamespace<PushSender>;
  ASSETS: Fetcher;
  /** Encrypts member link tokens and peppers the admin password hash. Generated once by CI. */
  TOKEN_KEY: string;
  /** Initial / recovery admin password, pushed from the GitHub secret on every deploy. */
  ADMIN_PASSWORD: string;
  /** From BotFather, pushed from the GitHub secret (production and the test site). Sites from sites.json
   *  have none: their Owner saves the bot in 设置 (telegram.ts botToken). Notifications wait for either. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Google Places (New) key for address suggestions; Photon is used while it is missing. */
  GOOGLE_MAPS_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Cloudflare Turnstile on the public forms (turnstile.ts): the site key is a public var, the secret
   *  is pushed from the GitHub secret; the check is off until both are set. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Ke Li's Azure (Microsoft Foundry) key: the models picked in 设置 → AI 模型 (ai.ts); 拍照登记 is
   *  hidden while it is missing. Pushed from the GitHub secret. */
  AZURE_FOUNDRY_API_KEY?: string;
  /** Public site address, for links in messages sent by the cron job (which has no request). */
  SITE_ORIGIN: string;
  /** An extra site's id in sites.json (each group's own site); missing on Jay's production and the test site. */
  SITE_ID?: string;
  /** The site's name until the Owner sets one in 设置; Jay's 羽毛球 when missing. */
  SITE_NAME?: string;
  /** Who sponsors the site's AI (拍照登记, release notes), thanked in every page's footer; no line
   *  while missing. SPONSOR_URL is the link on the name. Set in wrangler.jsonc, or per site in sites.json. */
  SPONSOR_NAME?: string;
  SPONSOR_URL?: string;
  /** The site's own icon colour: its icons come from public/site-icons/<SITE_ICON>/ (sites.json "icon");
   *  production's coral ones while missing. */
  SITE_ICON?: string;
  /** "production" or "staging" (the test site); missing in tests, which count as production. */
  ENVIRONMENT?: string;
  /** "1" turns on the 组织者 features (staging and local dev); "0" or missing keeps them off. */
  ORGANIZERS?: string;
}
