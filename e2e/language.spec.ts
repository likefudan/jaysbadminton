import { expect, test, type Page } from "@playwright/test";

/** 简 / 繁 / EN in the top bar: every page switches, the admin pages included. */
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
}

const pick = async (page: Page, name: string) => {
  await page.getByRole("button", { name: /^(语言|語言|Language)/ }).click();
  await page.getByRole("menuitemradio", { name }).click();
};

test("switching language on a member page, remembered on this device", async ({ page }) => {
  await member(page);
  await page.goto("/m/tok");
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await pick(page, "English");
  await expect(page.getByRole("heading", { name: "Hi, Dafei" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My events" })).toBeVisible();
  await expect(page.getByText("No sign-ups yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Hi, Dafei" })).toBeVisible();

  await pick(page, "繁體中文");
  await expect(page.getByRole("link", { name: "我的活動" })).toBeVisible();
  await expect(page.getByRole("link", { name: "個人資訊" })).toBeVisible();

  await pick(page, "简体中文");
  await expect(page.getByRole("link", { name: "我的活动" })).toBeVisible();
});

test("a phone set to Traditional Chinese starts in 繁體", async ({ browser }) => {
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "登入 / 註冊" })).toBeVisible();
  await expect(page.getByRole("button", { name: "語言：繁體中文" })).toBeVisible();
  await context.close();
});

test("admin pages follow the chosen language too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lang", "en"));
  await page.goto("/admin");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "First-time setup" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();

  await pick(page, "繁體中文");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByRole("heading", { name: "首次設定" })).toBeVisible();
});
