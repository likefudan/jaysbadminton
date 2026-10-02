import { test, expect } from "@playwright/test";

test("Google login explains when it is not configured", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByText("Google 登录暂未开通，请联系管理员完成配置。")).toBeVisible();
});

test("Google login navigates to the server authorization endpoint", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }));
  await page.route("**/api/auth/google", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Authorization redirect</h1>" }));
  await page.goto("/login");
  await page.getByRole("button", { name: "使用 Google 登录" }).click();
  await expect(page).toHaveURL(/\/api\/auth\/google$/);
  await expect(page.getByRole("heading", { name: "Authorization redirect" })).toBeVisible();
});

test("a Google user completes their profile and can sign out", async ({ page }) => {
  let registered = false, signedIn = true;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn, email: "alice@gmail.com", hasMember: registered, unavailable: false } }));
  await page.route("**/api/auth/register", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ username: "Alice", wechatNickname: "Alice微信" });
    registered = true;
    await route.fulfill({ json: { id: "M999" } });
  });
  await page.route("**/api/m/session/me", (route) => route.fulfill({ json: { id: "M999", username: "Alice", wechatNickname: "Alice微信", active: true, isOwner: false } }));
  await page.route("**/api/m/session/events", (route) => route.fulfill({ json: { events: [], friendCap: 3 } }));
  await page.route("**/api/m/session/stats", (route) => route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }));
  await page.route("**/api/auth/logout", async (route) => { signedIn = false; await route.fulfill({ json: { ok: true } }); });
  await page.goto("/me");
  await page.getByLabel(/^用户名/).fill("Alice");
  await page.getByLabel(/^微信昵称/).fill("Alice微信");
  await page.getByRole("button", { name: "完成注册，开始报名" }).click();
  await expect(page.getByRole("heading", { name: "你好，Alice" })).toBeVisible();
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole("button", { name: "退出 Google 登录" }).click();
  await expect(page.getByRole("button", { name: "使用 Google 登录" })).toBeVisible();
});

test("an existing member confirms binding before the account is linked", async ({ page }) => {
  let linked = false;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn: true, email: "alice@gmail.com", hasMember: false } }));
  await page.route("**/api/auth/link", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "existing-member-token" });
    linked = true;
    await route.fulfill({ status: 409, json: { error: { code: "already_linked", message: "此成员或 Google 账号已绑定，请使用原账号登录" } } });
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "已有成员链接？关联原账号" }).click();
  await page.getByLabel(/^原成员专属链接/).fill("http://localhost:8788/m/existing-member-token");
  expect(linked).toBe(false);
  await page.getByRole("button", { name: "确认绑定，进入我的活动" }).click();
  await expect(page.getByRole("alert")).toContainText("此成员或 Google 账号已绑定");
  expect(linked).toBe(true);
});
