import { test, expect } from "@playwright/test";

test("existing members stay on their page until Google is enabled, then authorize directly", async ({ page }) => {
  let enabled = false;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled, signedIn: false, hasMember: false } }));
  await page.route("**/api/m/existing-token/me", (route) => route.fulfill({ json: { id: "M007", username: "Dafei", active: true, isOwner: false } }));
  await page.route("**/api/m/existing-token/events", (route) => route.fulfill({ json: { events: [], friendCap: 3 } }));
  await page.route("**/api/m/existing-token/stats", (route) => route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }));
  await page.route("**/api/auth/google", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Authorization redirect</h1>" }));
  await page.goto("/m/existing-token");
  await expect(page.getByText(/网站尚未启用 Google 绑定/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await expect(page.getByRole("button", { name: "绑定 Google 账号", exact: true })).toHaveCount(0);
  enabled = true;
  await page.getByRole("button", { name: "重新检查绑定是否可用" }).click();
  await page.getByRole("button", { name: "绑定 Google 账号", exact: true }).click();
  await expect(page).toHaveURL(/\/api\/auth\/google$/);
  expect(await page.evaluate(() => sessionStorage.getItem("google-link-member"))).toBe("existing-token");
});

test("a signed-in account confirms the original member link before showing its activities", async ({ page }) => {
  let linked = false;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: true, signedIn: true, email: "alice@gmail.com", hasMember: true, unavailable: false } }));
  await page.route("**/api/m/*/me", (route) => route.fulfill({ json: { id: "M007", username: "Dafei", active: true, isOwner: false } }));
  await page.route("**/api/m/*/events", (route) => route.fulfill({ json: { events: [], friendCap: 3 } }));
  await page.route("**/api/m/*/stats", (route) => route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }));
  await page.route("**/api/auth/link", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "existing-token" });
    linked = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/m/existing-token");
  await page.getByRole("button", { name: "绑定 Google 账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "关联原有成员" })).toBeVisible();
  expect(linked).toBe(false);
  await page.getByRole("button", { name: "确认绑定，进入我的活动" }).click();
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await expect(page.getByText("M007 · 我的活动")).toBeVisible();
  expect(linked).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("google-link-member"))).toBeNull();
});

test("Google login explains when it is not configured", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByText("网站尚未启用 Google 登录。已有成员可以继续使用原专属链接。")).toBeVisible();
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
