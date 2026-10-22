import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Two more databases for checking a migration against data from before it: one with an Owner
        // and events, one for a site not set up yet.
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
    // A busy CI runner can take several times longer than usual; 5 s failed good runs on main.
    testTimeout: 15_000,
    // Every test file loads the Worker afresh; bundling these two big packages into one file each
    // (the Anthropic SDK is hundreds of small modules) saves each file about two seconds.
    deps: { optimizer: { ssr: { enabled: true, include: ["@anthropic-ai/sdk", "pinyin-pro"] } } },
  },
});
