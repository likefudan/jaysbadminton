import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

const bundle = buildSync({
  stdin: {
    contents: 'export { default as worker } from "./ops/src/index"; export { sign } from "./ops/src/logic";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  keepNames: true,
}).outputFiles[0].text;
const output = {
  exports: {} as {
    worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
    sign: (key: string, value: string, seconds: number) => Promise<string>;
  },
};
runInNewContext(bundle, {
  module: output,
  exports: output.exports,
  URL,
  TextEncoder,
  TextDecoder,
  crypto,
  atob,
  btoa,
  setTimeout,
  clearTimeout,
  AbortSignal,
  Headers,
  Response,
  console,
});

test("logout submits a same-origin form and removes the session", async ({ page, context }) => {
  const origin = "https://badminton.test";
  const env = {
    OPS_ORIGIN: origin,
    GITHUB_REPO: "test/repo",
    MAIN_SITE_DOMAIN: "example.com",
    OPS_EMAIL: "owner@example.com",
    OPS_SESSION_KEY: "test-key",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  };
  await context.addCookies([
    {
      name: "__Host-ops",
      value: await output.exports.sign("test-key", "owner@example.com", 3600),
      domain: "badminton.test",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  let logoutOrigin: string | undefined;
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    if (request.url().endsWith("/api/state"))
      return route.fulfill({ json: { pendingCount: 0, sites: [], deploys: [] } });
    if (request.url().endsWith("/logout")) logoutOrigin = request.headers().origin;
    const response = await output.exports.worker.fetch(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      }),
      env,
      { waitUntil: () => {} },
    );
    await route.fulfill({
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        ...(response.headers.has("Set-Cookie") ? { "Set-Cookie": response.headers.getSetCookie().join("\n") } : {}),
      },
      body: await response.text(),
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByRole("link", { name: "用 Google 登录" })).toBeVisible();
  expect(logoutOrigin).toBe(origin);
  expect((await context.cookies()).find((cookie) => cookie.name === "__Host-ops")).toBeUndefined();
});
