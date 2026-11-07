import { expect, test } from "@playwright/test";

const IPHONE_WECHAT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x18003637) NetType/WIFI Language/zh_CN";
const ANDROID_WECHAT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 MicroMessenger/8.0.54.2660(0x28003637) NetType/WIFI Language/zh_CN";

const event = {
  id: 7,
  code: "AB12",
  date: "2030-10-15",
  startTime: "19:00",
  endTime: "21:00",
  location: "Synergy",
  address: "",
  title: "",
  deadlineAt: "2030-10-14T02:00:00.000Z",
  status: "open",
  headcount: 2,
};

test.describe("in WeChat on iPhone", () => {
  test.use({ userAgent: IPHONE_WECHAT });

  /** Google sign-in fails in WeChat (Ke Li, A + C): a strip says to open in Safari, 登录 / 注册 shows the steps. */
  test("a visitor is told to open the page in Safari before signing in", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
    );
    await page.route("**/api/public/events/AB12", (route) => route.fulfill({ json: event }));
    await page.goto("/e/AB12");
    const banner = page.locator(".wechat-banner");
    await expect(banner).toContainText("微信里不能用 Google 登录");
    await expect(banner).toContainText("选「在 Safari 中打开」");

    await page.locator(".topbar").getByRole("link", { name: "登录 / 注册" }).click();
    const sheet = page.getByRole("dialog", { name: "用 Safari 登录" });
    await expect(sheet).toContainText("选「在 Safari 中打开」");
    await expect(page).toHaveURL(/\/e\/AB12$/);
    await sheet.getByRole("button", { name: "返回" }).click();
    await expect(sheet).toHaveCount(0);

    // ✕ hides the strip for the rest of this visit.
    await banner.getByRole("button", { name: "关闭" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".ev-card")).toBeVisible();
    await expect(page.locator(".wechat-banner")).toHaveCount(0);
  });

  test("the Google button on the sign-in page shows the steps instead", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
    );
    await page.goto("/me");
    await page.getByRole("button", { name: "用 Google 登录 / 注册" }).click();
    await expect(page.getByRole("dialog", { name: "用 Safari 登录" })).toBeVisible();
    await expect(page).toHaveURL(/\/me$/);
  });

  test("a signed-in member sees no strip", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { enabled: true, signedIn: true, hasMember: true, pending: false } }),
    );
    await page.route("**/api/public/events/AB12", (route) => route.fulfill({ json: event }));
    await page.route("**/api/m/session/events/7", (route) => route.abort());
    await page.goto("/e/AB12");
    await expect(page.locator(".ev-card")).toBeVisible();
    await expect(page.locator(".wechat-banner")).toHaveCount(0);
  });
});

test.describe("in WeChat on Android", () => {
  test.use({ userAgent: ANDROID_WECHAT });

  test("says to open the page in the browser, in English too", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
    );
    await page.route("**/api/public/events/AB12", (route) => route.fulfill({ json: event }));
    await page.goto("/e/AB12");
    await expect(page.locator(".wechat-banner")).toContainText("选「在浏览器打开」");
    await page.evaluate(() => localStorage.setItem("lang", "en"));
    await page.reload();
    await expect(page.locator(".wechat-banner")).toContainText('choose "Open in Browser"');
  });
});

test("no strip outside WeChat", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/public/events/AB12", (route) => route.fulfill({ json: event }));
  await page.goto("/e/AB12");
  await expect(page.locator(".ev-card")).toBeVisible();
  await expect(page.locator(".wechat-banner")).toHaveCount(0);
});
