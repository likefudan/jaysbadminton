import { test, expect } from "@playwright/test";

test("existing members stay on their page until Google is enabled, then authorize directly", async ({ page }) => {
  let enabled = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/existing-token/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/existing-token/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.route("**/api/m/existing-token/stats", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }),
  );
  await page.route("**/api/auth/google", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Authorization redirect</h1>" }),
  );
  await page.goto("/m/existing-token/profile"); // binding Google lives on 个人信息
  await expect(page.getByText(/网站尚未启用 Google 绑定/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "个人信息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "绑定 Google 账号", exact: true })).toHaveCount(0);
  enabled = true;
  await page.getByRole("button", { name: "重新检查绑定是否可用" }).click();
  await page.getByRole("button", { name: "绑定 Google 账号", exact: true }).click();
  await expect(page).toHaveURL(/\/api\/auth\/google$/);
  expect(await page.evaluate(() => sessionStorage.getItem("google-link-member"))).toBe("existing-token");
});

test("a signed-in account confirms the original member link before showing its activities", async ({ page }) => {
  let linked = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { enabled: true, signedIn: true, email: "alice@gmail.com", hasMember: true, pending: false },
    }),
  );
  await page.route("**/api/m/*/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/*/events", (route) => route.fulfill({ json: { events: [], history: [], friendCap: 3 } }));
  await page.route("**/api/m/*/stats", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }),
  );
  await page.route("**/api/auth/link", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "existing-token" });
    linked = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/m/existing-token/profile");
  await page.getByRole("button", { name: "绑定 Google 账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "关联原有成员" })).toBeVisible();
  expect(linked).toBe(false);
  await page.getByRole("button", { name: "确认绑定，进入我的活动" }).click();
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("M007"); // members never see their ID
  expect(linked).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("google-link-member"))).toBeNull();
});

test("登录 / 注册 offers email alone when Google is not configured", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录 / 注册", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "用 Google 登录 / 注册" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "用邮箱注册" })).toHaveAttribute("href", "/join");
});

test("a member who lost their link asks for it again", async ({ page }) => {
  let asked: unknown = null;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/public/recover-link", async (route) => {
    asked = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "已经是成员？找回我的专属链接" }).click();
  await expect(page.getByRole("heading", { name: "找回我的专属链接" })).toBeVisible();
  await page.getByLabel("邮箱").fill("not-an-email");
  await page.getByRole("button", { name: "发送专属链接" }).click();
  await expect(page.getByText("邮箱格式不对")).toBeVisible();
  expect(asked).toBeNull();
  await page.getByLabel("邮箱").fill("alice@example.com");
  await page.getByRole("button", { name: "发送专属链接" }).click();
  await expect(page.getByRole("status")).toContainText("如果 alice@example.com 是已通过审核的成员邮箱");
  expect(asked).toEqual({ email: "alice@example.com", website: "" });
});

test("Google login navigates to the server authorization endpoint", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/auth/google", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Authorization redirect</h1>" }),
  );
  await page.goto("/login");
  await page.getByRole("button", { name: "用 Google 登录 / 注册" }).click();
  await expect(page).toHaveURL(/\/api\/auth\/google$/);
  await expect(page.getByRole("heading", { name: "Authorization redirect" })).toBeVisible();
});

test("a Google newcomer applies, waits for approval, then gets in and can sign out", async ({ page }) => {
  let applied = false,
    approved = false,
    signedIn = true;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { enabled: true, signedIn, email: "alice@gmail.com", hasMember: approved, pending: applied && !approved },
    }),
  );
  await page.route("**/api/auth/register", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ username: "Alice", wechatNickname: "alice_wx", message: "" });
    applied = true;
    await route.fulfill({ json: { id: "M999", pending: true } });
  });
  await page.route("**/api/m/session/me", (route) =>
    route.fulfill({
      json: { id: "M999", username: "Alice", wechatNickname: "Alice微信", active: true, isOwner: false },
    }),
  );
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.route("**/api/m/session/stats", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "暂无统计" } } }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "申请加入" })).toBeVisible();
  // Same form as 用邮箱注册 (minus the email): two names, the note is optional.
  await page.getByLabel(/^用户名/).fill("Alice");
  await page.getByLabel(/^微信名/).fill("alice_wx");
  await page.getByRole("button", { name: "提交入群申请" }).click();

  // Not in yet: the Owner has to approve first.
  await expect(page.getByRole("heading", { name: "申请已提交" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "你好，Alice" })).toHaveCount(0);

  approved = true;
  await page.getByRole("button", { name: "刷新审核状态" }).click();
  await expect(page.getByRole("heading", { name: "你好，Alice" })).toBeVisible();
  await expect(page).toHaveURL(/\/me$/);
  // Signing out lives in the avatar menu.
  await page.getByRole("button", { name: "Google 账号：alice@gmail.com" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "用 Google 登录 / 注册" })).toBeVisible();
});

test("an existing member confirms binding before the account is linked", async ({ page }) => {
  let linked = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: true, email: "alice@gmail.com", hasMember: false } }),
  );
  await page.route("**/api/auth/link", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "existing-member-token" });
    linked = true;
    await route.fulfill({
      status: 409,
      json: { error: { code: "already_linked", message: "此成员或 Google 账号已绑定，请使用原账号登录" } },
    });
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "已有成员链接？关联原账号" }).click();
  await page.getByLabel(/^原成员专属链接/).fill("http://localhost:8788/m/existing-member-token");
  expect(linked).toBe(false);
  await page.getByRole("button", { name: "确认绑定，进入我的活动" }).click();
  await expect(page.getByRole("alert")).toContainText("此成员或 Google 账号已绑定");
  expect(linked).toBe(true);
});

test("the admin gets in with the bound Google account; another account is told so", async ({ page }) => {
  let isAdmin = false;
  await page.route("**/api/public/admin-setup", (route) => route.fulfill({ json: { needed: false } }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { enabled: true, signedIn: true, email: "someone@gmail.com", hasMember: false, pending: false, isAdmin },
    }),
  );
  await page.route("**/api/admin/google/members", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "google_admin_required", message: "请用管理员绑定的 Google 账号登录" } },
    }),
  );
  await page.route(/\/api\/auth\/google\?next=/, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Authorization redirect</h1>" }),
  );

  await page.goto("/admin/google");
  await expect(page.getByText("当前登录的 Google 账号 someone@gmail.com 不是管理员绑定的账号。")).toBeVisible();
  await page.getByRole("button", { name: "换一个 Google 账号登录" }).click();
  await expect(page).toHaveURL(/\/api\/auth\/google\?next=\/admin\/google$/);

  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "用 Google 登录管理页" })).toBeVisible();
  isAdmin = true;
  await page.reload();
  await expect(page.getByRole("link", { name: "进入管理页" })).toHaveAttribute("href", "/admin/google");
});

test("a signed-in member sees the roster and can sign up on the shared event page", async ({ page }) => {
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
  let signedUp = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { enabled: true, signedIn: true, email: "alice@gmail.com", hasMember: true, pending: false },
    }),
  );
  await page.route("**/api/public/events/AB12", (route) => route.fulfill({ json: event }));
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({
      json: {
        friendCap: 3,
        events: [
          {
            ...event,
            headcount: signedUp ? 3 : 2,
            canEdit: true,
            payment: null,
            myFriends: signedUp ? [] : null,
            selfSignedUp: signedUp,
            roster: signedUp
              ? [
                  { name: "Jay", friendOf: null, mine: false, absent: false },
                  { name: "Bob", friendOf: null, mine: false, absent: false },
                  { name: "Alice", friendOf: null, mine: true, absent: false },
                ]
              : null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/m/session/events/7/signup", async (route) => {
    signedUp = true;
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/e/AB12");
  await expect(page.getByText("登录后即可报名；新朋友请先注册入群。")).toHaveCount(0);
  await page.getByRole("button", { name: "报名", exact: true }).click();
  await page.getByRole("button", { name: "确认报名" }).click();
  await expect(page.getByText("✓ 已报名")).toBeVisible();
  await expect(page.locator(".roster-fold summary")).toHaveText("名单（3 人）");
  await expect(page.getByRole("link", { name: "我的活动" })).toBeVisible();
});

test("a visitor still sees only the headcount on the shared event page", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: true, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/public/events/AB12", (route) =>
    route.fulfill({
      json: {
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
      },
    }),
  );
  await page.goto("/e/AB12");
  await expect(page.getByText("2 人已报名")).toBeVisible();
  await expect(page.getByText("登录后即可报名；新朋友请先注册入群。")).toBeVisible();
  await expect(page.getByRole("link", { name: "登录 / 注册" })).toBeVisible();
  await expect(page.locator(".roster-fold")).toHaveCount(0);
});
