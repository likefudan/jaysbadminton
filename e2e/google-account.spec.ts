import { test, expect } from "@playwright/test";

test("signed-in users can inspect their Google account from the header and sign out", async ({ page }) => {
  let signedIn = true, failLogout = true;
  const email = "demo.member@gmail.com";
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn, email: signedIn ? email : null, hasMember: true } }));
  await page.route("**/api/auth/logout", async (route) => {
    if (failLogout) return route.fulfill({ status: 503, json: { error: { message: "暂时无法退出，请重试" } } });
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/privacy");
  const trigger = page.getByRole("button", { name: `Google 账号：${email}`, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole("region", { name: "Google 账号信息" });
  await expect(panel.getByText(email, { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "我的活动" })).toHaveAttribute("href", "/me");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(4, 600);
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await panel.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("暂时无法退出，请重试");
  failLogout = false;
  await page.evaluate(() => sessionStorage.setItem("google-link-member", "old-link"));
  await panel.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /^Google 账号：/ })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("google-link-member"))).toBeNull();
});

test("signed-out users do not see a Google account badge", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn: false, email: null } }));
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "使用 Google 登录" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Google 账号：/ })).toHaveCount(0);
});

test("the account panel fits a narrow screen with a long email in light and dark modes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: true, email: "a.long.google.account.address@example.com" } }));
  await page.goto("/privacy");
  await page.getByRole("button", { name: /^Google 账号：/ }).click();
  const panel = page.getByRole("region", { name: "Google 账号信息" });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await page.screenshot({ path: `/private/tmp/jaysbadminton-google-account-${mode}.png` });
  }
});
