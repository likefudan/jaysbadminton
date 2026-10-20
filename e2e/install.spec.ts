import { expect, test, type Page } from "@playwright/test";

/**
 * 添加到主屏幕 on a member's pages. Chrome's install prompt is faked (a test browser never offers
 * one); iPhone is its user agent, where the button opens the Safari steps instead.
 */
async function member(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dafei", wechatNickname: "dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
}

/** What Chrome hands the page when the site can be installed. */
async function offerInstall(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((outcome) => {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as any;
    e.prompt = async () => {
      (window as any).prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome });
    dispatchEvent(e);
  }, outcome);
}

const offer = (page: Page) => page.getByText("把羽毛球添加到主屏幕");
const pushOffer = (page: Page) => page.getByText("开启推送，新活动开始报名、账单出来时第一时间知道。");

test("Chrome: one tap installs, then push is offered", async ({ page }) => {
  await member(page);
  await page.goto("/m/tok");
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  // Nothing to offer until the browser says it can install.
  await expect(offer(page)).toBeHidden();
  await expect(pushOffer(page)).toBeVisible();

  await offerInstall(page, "accepted");
  await expect(offer(page)).toBeVisible();
  await expect(pushOffer(page)).toBeHidden();
  await page.getByRole("button", { name: "添加到主屏幕" }).click();
  expect(await page.evaluate(() => (window as any).prompted)).toBe(true);
  await expect(offer(page)).toBeHidden();
  await expect(pushOffer(page)).toBeVisible();
});

test("不用了 keeps the offer off 我的活动, 个人信息 still has it", async ({ page }) => {
  await member(page);
  await page.goto("/m/tok");
  await offerInstall(page, "dismissed");
  await page.locator(".install-offer").getByRole("button", { name: "不用了" }).click();
  await expect(offer(page)).toBeHidden();

  await page.getByRole("link", { name: "个人信息" }).click();
  await page.locator(".set-list").getByRole("button", { name: "添加到主屏幕" }).click();
  expect(await page.evaluate(() => (window as any).prompted)).toBe(true);
});

test.describe("iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  });

  test("the button shows Safari's steps; 个人信息 adds from 我的活动", async ({ page }) => {
    await member(page);
    await page.goto("/m/tok");
    await expect(offer(page)).toBeVisible();
    await page.getByRole("button", { name: "添加到主屏幕" }).click();
    const guide = page.getByRole("dialog", { name: "添加到主屏幕" });
    await expect(guide.getByText("往下滑，选「添加到主屏幕」")).toBeVisible();
    await guide.getByRole("button", { name: "关闭" }).click();
    await expect(guide).toBeHidden();

    await page.goto("/m/tok/profile");
    await page.getByRole("link", { name: "添加到主屏幕" }).click();
    await expect(guide).toBeVisible();
    // What Safari adds is 我的活动 itself, not the ?add=1 that opened the steps.
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/m/tok");
  });

  test("opened from the home screen, nothing is offered", async ({ page }) => {
    await member(page);
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
    await page.goto("/m/tok");
    await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
    await expect(offer(page)).toBeHidden();
    await page.goto("/m/tok/profile");
    await expect(page.getByRole("button", { name: /推送通知/ })).toBeVisible();
    await expect(page.getByText("添加到主屏幕")).toBeHidden();
  });
});

test.describe("WeChat", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 MicroMessenger/8.0.50",
  });

  test("says to open the page in a browser", async ({ page }) => {
    await member(page);
    await page.goto("/m/tok");
    await expect(page.getByText("微信里不能添加。")).toBeVisible();
    await page.getByRole("button", { name: "怎么打开" }).click();
    await expect(page.getByRole("dialog", { name: "用浏览器打开" }).getByText("选「在浏览器打开」")).toBeVisible();
  });
});
