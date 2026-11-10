import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { createServer } from "node:http";
import { once } from "node:events";

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
  let logoutOrigin: string | undefined;
  let origin = "";
  const env = {
    OPS_ORIGIN: "",
    GITHUB_REPO: "test/repo",
    MAIN_SITE_DOMAIN: "example.com",
    OPS_EMAIL: "owner@example.com",
    OPS_SESSION_KEY: "test-key",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  };
  // Use a real HTTP redirect and separate Set-Cookie headers, rather than a routed
  // redirect: the browser must update its cookie jar before the follow-up request.
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/api/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ pendingCount: 0, sites: [], deploys: [] }));
        return;
      }
      if (req.url === "/logout") logoutOrigin = req.headers.origin;
      const response = await output.exports.worker.fetch(
        new Request(origin + req.url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
        }),
        env,
        { waitUntil: () => {} },
      );
      res.statusCode = response.status;
      for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
      if (response.headers.has("set-cookie")) res.setHeader("Set-Cookie", response.headers.getSetCookie());
      res.end(await response.text());
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port");
  origin = `http://localhost:${address.port}`;
  env.OPS_ORIGIN = origin;
  try {
    await context.addCookies([
      {
        name: "__Host-ops",
        value: await output.exports.sign("test-key", "owner@example.com", 3600),
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(origin);
    await page.getByRole("button", { name: "退出" }).click();
    await expect(page.getByRole("link", { name: "用 Google 登录" })).toBeVisible();
    expect(logoutOrigin).toBe(origin);
    expect((await context.cookies()).find((cookie) => cookie.name === "__Host-ops")).toBeUndefined();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
