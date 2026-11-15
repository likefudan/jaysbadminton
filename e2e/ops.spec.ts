import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

// Match Wrangler's keepNames transform, which previously leaked __name into app.js.
const bundle = buildSync({
  entryPoints: ["ops/src/page.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  keepNames: true,
}).outputFiles[0].text;
const output = { exports: {} as { APP_CSS: string; APP_JS: string } };
runInNewContext(bundle, { module: output, exports: output.exports, TextEncoder });
const { APP_CSS, APP_JS } = output.exports;

// Exercise the version picker without real login or starting a production release.
test("each site's row opens a usable version picker", async ({ page }) => {
  const tags = ["v2026.11.10.2", "v2026.11.10", "v2026.11.09"];
  const sites = ["Jay's", "SBBC", "Be With You", "Coco"].map((name, i) => ({
    id: String(i),
    name,
    domain: "example.com",
    color: "#e8664f",
    ok: true,
    version: tags[1],
    behind: 1,
    movable: tags.slice(0, 2),
  }));
  const releases: unknown[] = [];
  await page.route("**/api/release", (route) => {
    expect(route.request().method()).toBe("POST");
    releases.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        sites,
        me: { role: "engineer" },
        latest: tags[0],
        pendingCount: 0,
        deploys: [],
        versions: tags.map((tag) => ({ tag, date: "2026-11-10T00:00:00Z", perSite: true })),
      },
    }),
  );
  await page.route("**/ops-picker-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="app"></div>',
    }),
  );
  await page.goto("/ops-picker-test");
  await page.addStyleTag({ content: APP_CSS });
  await page.addScriptTag({ content: APP_JS });
  for (const site of sites) {
    await page.locator(".siterow").filter({ hasText: site.name }).locator(".chev").tap();
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "选一个版本" })).toBeDisabled();
    await expect(page.locator(".opt input").nth(1)).toBeDisabled();
    // A version behind the site's migrations can be chosen, but only through 恢复备份, which asks first.
    await page.locator(".opt input").nth(2).check();
    await page.getByRole("button", { name: `恢复备份并换到 ${tags[2]}` }).click();
    await expect(page.getByRole("button", { name: `恢复并换到 ${tags[2]}` })).toBeDisabled();
    await page.locator(".sheet .confirm").fill(site.id);
    await expect(page.getByRole("button", { name: `恢复并换到 ${tags[2]}` })).toBeEnabled();
    await page.locator(".sheet").getByRole("button", { name: "取消" }).click();
    await expect(page.locator(".sheet")).toHaveCount(0);
    await page.locator(".opt input").first().check();
    await expect(page.getByRole("button", { name: `换到 ${tags[0]}` })).toBeEnabled();
    // Cancel first: no request is sent and the picker remains usable.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: `换到 ${tags[0]}` }).click();
    await expect(page.getByRole("button", { name: `换到 ${tags[0]}` })).toBeEnabled();
    expect(releases).toHaveLength(Number(site.id));

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `换到 ${tags[0]}` }).click();
    await expect(page.locator(".panel")).toHaveCount(0);
    expect(releases).toHaveLength(Number(site.id) + 1);
    expect(releases.at(-1)).toEqual({ sites: [site.id], tag: tags[0] });
  }
  expect(errors).toEqual([]);
});

// A viewer sees the same list but cannot pick a version or release.
test("a viewer's version list has no release button", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        sites: [
          {
            id: "jays",
            name: "Jay's 羽毛球",
            domain: "x",
            color: "#e8664f",
            version: "v2026.11.10",
            ok: true,
            behind: 0,
            movable: ["v2026.11.10", "v2026.11.09"],
          },
        ],
        me: { role: "viewer" },
        latest: "v2026.11.10",
        pendingCount: 0,
        deploys: [],
        versions: ["v2026.11.10", "v2026.11.09"].map((tag) => ({ tag, date: "2026-11-10T00:00:00Z", perSite: true })),
      },
    }),
  );
  await page.route("**/ops-viewer-test", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }),
  );
  await page.goto("/ops-viewer-test");
  await page.addStyleTag({ content: APP_CSS });
  await page.addScriptTag({ content: APP_JS });
  await page.locator(".siterow .chev").tap();
  await expect(page.locator(".panel")).toBeVisible();
  await expect(page.locator(".opt input").nth(1)).toBeDisabled();
  await expect(page.locator(".panel .foot button")).toHaveCount(0);
  await expect(page.locator(".panel .foot")).toContainText("只读");
  await expect(page.getByText("用户和权限")).toHaveCount(0);
  // 所有版本: a version a site runs says where (this once threw "list is not a function").
  await page.route("**/api/releases?page=1", (route) =>
    route.fulfill({
      json: {
        releases: [
          {
            tag: "v2026.11.10",
            date: "2026-11-10T00:00:00Z",
            url: "https://github.com/o/r/releases/tag/v2026.11.10",
            notes: [{ text: "A", pr: 1 }],
          },
        ],
        more: false,
      },
    }),
  );
  await page.goBack();
  await expect(page.locator(".panel")).toHaveCount(0);
  await page.getByText("所有版本和发布说明").click();
  await expect(page.locator(".rel .relon")).toHaveText("在用：Jay's");
  await expect(page.getByText("没读到")).toHaveCount(0);
  expect(errors).toEqual([]);
});
