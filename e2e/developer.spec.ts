import { test, expect } from "@playwright/test";

test("staging offers developer login, a recolored logo and a floating role switch", async ({ page }, testInfo) => {
  let signedIn = false;
  await page.route("**/api/public/site", (route) =>
    route.fulfill({ json: { title: "Jay's 羽毛球", theme: "minimal-coral", staging: true } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn, hasMember: signedIn, email: null } }),
  );
  await page.route("**/api/developer/session", (route) => route.fulfill({ json: { signedIn } }));
  await page.route("**/api/developer/login", (route) => {
    expect(route.request().postDataJSON()).toEqual({ password: "staging-password" });
    signedIn = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/developer/logout", (route) => {
    signedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/m/session/me", (route) =>
    route.fulfill({ json: { id: "MDEV", username: "开发测试", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.route("**/api/m/session/stats", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }),
  );
  await page.route("**/api/admin/developer/members", (route) =>
    route.fulfill({
      json: {
        active: [],
        pending: [],
        inactive: [],
        deleted: [],
        organizers: null,
        viewer: {
          id: "MDEV",
          role: "owner",
          caps: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
        },
      },
    }),
  );
  await page.route("**/api/admin/developer/events", (route) => route.fulfill({ json: { events: [] } }));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "开发者登录" })).toBeVisible();
  await expect(page.locator(".logo-staging")).toBeVisible();
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", "/favicon-staging.svg");
  await page.getByLabel("开发者密码").fill("staging-password");
  await page.getByRole("button", { name: "开发者登录", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: "你好，开发测试" })).toBeVisible();
  const switcher = page.getByRole("button", { name: "开发者 · 切换界面" });
  await switcher.click();
  await page.getByRole("link", { name: "群主界面", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/developer$/);
  await expect(page.getByRole("heading", { name: "管理页", level: 1 })).toBeVisible();
  await switcher.click();
  await page.getByRole("link", { name: "普通用户界面", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await switcher.click();
  await page.screenshot({ path: testInfo.outputPath("staging-developer.png") });
  await page.getByRole("button", { name: "退出开发者登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(switcher).toHaveCount(0);
});

test("production has neither developer login nor staging logo", async ({ page }) => {
  await page.route("**/api/public/site", (route) =>
    route.fulfill({ json: { title: "Jay's 羽毛球", theme: "minimal-coral", staging: false } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
  );
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "用 Google 登录 / 注册" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "开发者登录" })).toHaveCount(0);
  await expect(page.locator(".logo-staging")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开发者 · 切换界面" })).toHaveCount(0);
});
