import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// What applyD1Migrations does, without importing "cloudflare:test" into every test file.
for (const m of env.TEST_MIGRATIONS) await env.DB.batch(m.queries.map((q) => env.DB.prepare(q)));

const TABLES = [
  "payment_diagnostics",
  "calorie_uploads",
  "calories",
  "release_notices",
  "telegram_langs",
  "push_outbox",
  "push_subscriptions",
  "event_audit",
  "payment_aliases",
  "payment_profiles",
  "telegram_bindings",
  "member_sessions",
  "oauth_states",
  "notification_log",
  "email_log",
  "inbound_payments",
  "payment_receipts",
  "payments",
  "settlements",
  "registrations",
  "ai_usage",
  "court_map_history",
  "court_map_photos",
  "court_maps",
  "queue_photos",
  "queue_courts",
  "queue_accounts",
  "queue_credits",
  "lottery_watchers",
  "lottery_winners",
  "lottery_entries",
  "lottery_excluded",
  "lottery_optouts",
  "lotteries",
  "likes",
  "extra_spend",
  "member_avatars",
  "events",
  "locations",
  "admin_sessions",
  "members",
];

// Start every test from the freshly migrated state.
beforeEach(async () => {
  await env.DB.batch([
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare("DELETE FROM settings WHERE key != 'next_member_seq'"),
    env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'next_member_seq'"),
  ]);
});
