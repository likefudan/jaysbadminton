import { defineConfig } from "@playwright/test";

/**
 * Browser tests of the main flows against a local Worker with a fresh database
 * (scripts/e2e-server.sh). Run with `npm run test:e2e`; CI runs them before deploying.
 */
export default defineConfig({
  testDir: "e2e",
  // CI runs flows.spec.ts on one machine (`playwright test flows`) and the rest on another.
  testIgnore: process.env.E2E_SKIP_FLOWS ? "**/flows.spec.ts" : undefined,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8788",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    // A preinstalled Chromium elsewhere (e.g. a sandbox) instead of Playwright's own download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "sh scripts/e2e-server.sh",
    url: "http://localhost:8788/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
