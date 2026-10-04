import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // A second, empty database for checking a migration against data from before it.
        d1Databases: { MIGRATION_DB: "migration-test", MIGRATION_DB_EMPTY: "migration-test-empty" },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          TOKEN_KEY: "test-token-key",
          ADMIN_PASSWORD: "initial-password",
          TELEGRAM_BOT_TOKEN: "test-bot-token",
          // As in production, whatever a local .dev.vars says; tests that need it on pass their own env.
          ORGANIZERS: "0",
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
