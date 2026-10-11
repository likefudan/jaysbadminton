import { expect, test, type Page } from "@playwright/test";

/**
 * A page left open shows what's new without a reload: on coming back after a while, and (in the
 * app on the home screen, which has no reload) by pulling down.
 */
async function member(page: Page) {
  let name = "Dafei";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: name, wechatNickname: "dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { get: () => !!(window as any).away });
  });
  return { rename: (n: string) => (name = n) };
}

test("coming back after a while loads the page again", async ({ page }) => {
  await page.clock.install();
  const site = await member(page);
  await page.goto("/m/tok");
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  site.rename("大飞");

  const away = async (ms: number) => {
    await page.evaluate(() => {
      (window as any).away = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(ms);
    await page.evaluate(() => {
      (window as any).away = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };
  // A quick look at another app: nothing reloads.
  await away(5_000);
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await away(60_000);
  await expect(page.getByRole("heading", { name: "你好，大飞" })).toBeVisible();
});

test("the home-screen app refreshes on pull-down", async ({ page }) => {
  const site = await member(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("/m/tok");
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  site.rename("大飞");
  await page.evaluate(async () => {
    const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
    const fire = (type: string, y: number) =>
      dispatchEvent(
        new TouchEvent(type, { touches: type === "touchend" ? [] : [touch(y)], changedTouches: [touch(y)] }),
      );
    fire("touchstart", 100);
    for (let y = 120; y <= 220; y += 20) fire("touchmove", y);
    fire("touchend", 220);
  });
  await expect(page.getByRole("heading", { name: "你好，大飞" })).toBeVisible();
});
