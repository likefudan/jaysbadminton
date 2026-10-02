export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Encrypts member link tokens and peppers the admin password hash. Generated once by CI. */
  TOKEN_KEY: string;
  /** Initial / recovery admin password, pushed from the GitHub secret on every deploy. */
  ADMIN_PASSWORD: string;
  /** From BotFather, pushed from the GitHub secret; notifications are skipped while it is missing. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Google Places (New) key for address suggestions; Photon is used while it is missing. */
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Public site address, for links in messages sent by the cron job (which has no request). */
  SITE_ORIGIN: string;
}
