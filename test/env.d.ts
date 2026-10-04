import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/worker/index");
    }
    interface Env {
      DB: D1Database;
      MIGRATION_DB: D1Database;
      DEADLINES: DurableObjectNamespace<import("../src/worker/deadlines").DeadlineAlarm>;
      ASSETS: Fetcher;
      TEST_MIGRATIONS: D1Migration[];
      TOKEN_KEY: string;
      ADMIN_PASSWORD: string;
      TELEGRAM_BOT_TOKEN?: string;
      GOOGLE_MAPS_API_KEY?: string;
      SITE_ORIGIN: string;
      ORGANIZERS?: string;
    }
  }
}
