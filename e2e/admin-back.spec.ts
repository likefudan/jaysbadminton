import { expect, test } from "@playwright/test";

/**
 * 管理页 going back (src/web/adminNav.ts): each page one taps into has its own history entry, so
 * the browser's back (the iPhone's edge swipe, Android's back button) goes up one level like 「‹」,
 * a reload stays put, and tabs don't pile up entries.
 */
test("管理页: back goes up one level, reload stays, tabs replace", async ({ page }) => {
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (r) =>
    r.fulfill({ json: { pending: [], active: [], inactive: [], deleted: [], viewer: { caps: ["owner"] } } }),
  );
  await page.route("**/api/admin/test-token/events?*", (r) =>
    r.fulfill({ json: { current: [], past: [], morePast: false } }),
  );
  await page.route("**/api/admin/test-token/telegram", (r) => r.fulfill({ json: {} }));
  // Everything 高级设置's cards read: one that throws while drawing leaves the page before it on
  // screen (it was drawn twice here about one run in five, when this answered {}).
  const settings = {
    likes: { hours: 48, pct: 50 },
    calorieShortcut: { url: "", version: 1 },
    ai: { photo: { model: "m", effort: "low" }, notes: { model: "m", effort: "low" } },
  };
  await page.route("**/api/admin/test-token/settings", (r) => r.fulfill({ json: settings }));
  await page.route("**/api/admin/test-token/settings/ai-models", (r) =>
    r.fulfill({ json: { models: ["m"], ready: true } }),
  );

  // Where the 管理页 was opened from: going back from its first page leaves it.
  await page.goto("/privacy");
  await page.goto("/admin/test-token");
  const tabs = page.locator(".tabs");
  await expect(page.getByRole("button", { name: "＋ 新建活动" })).toBeVisible();

  // Tabs replace the entry instead of adding one.
  await tabs.getByRole("button", { name: "成员" }).click();
  await tabs.getByRole("button", { name: "设置" }).click();
  await expect(page).toHaveURL(/\?tab=settings$/);

  // Down two levels, then the browser's back twice: one level each.
  await page.getByRole("button", { name: /^高级设置/ }).click();
  await expect(page).toHaveURL(/\?tab=settings&sub=advanced$/);
  await page.getByRole("button", { name: /Google 表格同步/ }).click();
  await expect(page).toHaveURL(/sub=sheets$/);
  await expect(page.locator(".sub-bar").getByRole("button", { name: "高级设置" })).toBeVisible();

  // A reload keeps the page, and 「‹」 still goes back through the same entries.
  await page.reload();
  await expect(page.locator(".sub-bar").getByRole("button", { name: "高级设置" })).toBeVisible();
  await page.goBack();
  // For a moment the page being left can still show its bar too; wait until only one is there.
  await expect(page.getByRole("heading", { name: "高级设置" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "高级设置" })).toBeVisible();
  await page.locator(".sub-bar").getByRole("button", { name: "设置" }).click();
  await expect(page).toHaveURL(/\?tab=settings$/);
  await expect(page.getByRole("button", { name: /^外观和公共页面/ })).toBeVisible();

  // A page one level down has the panel-style bar instead of the site's top bar and the tabs.
  await page.getByRole("button", { name: /^收款设置/ }).click();
  await expect(page.locator(".sub-bar")).toContainText("收款设置");
  await expect(tabs).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await page.locator(".sub-bar").getByRole("button", { name: "设置" }).click();
  await expect(tabs).toBeVisible();
  await expect(page).toHaveURL(/\?tab=settings$/);

  // 新建活动 is a level too; the browser's back returns to the list.
  await tabs.getByRole("button", { name: "活动" }).click();
  await page.getByRole("button", { name: "＋ 新建活动" }).click();
  await expect(page).toHaveURL(/\?tab=events&event=new$/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "＋ 新建活动" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/test-token$/);

  // Nothing above piled up: one more back leaves the 管理页 for where it was opened from.
  await page.goBack();
  await expect(page).toHaveURL(/\/privacy$/);

  // Opened straight into a sub-page (as Google sign-in comes back): 「‹」 goes up in place.
  // On a wide screen the page sits beside its list with the site's top bar instead.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/test-token?tab=settings&sub=pay");
  await page.locator(".sub-bar").getByRole("button", { name: "设置" }).click();
  await expect(page).toHaveURL(/\?tab=settings$/);
});

/** The 「‹ 上一级」 bar slides up while reading down and back going up, like the site's top bar (Ke Li 2026-11-18). */
test("a page one level down: its bar slides away and back", async ({ page }) => {
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (r) =>
    r.fulfill({ json: { pending: [], active: [], inactive: [], deleted: [], viewer: { caps: ["owner"] } } }),
  );
  await page.route("**/api/admin/test-token/events?*", (r) =>
    r.fulfill({ json: { current: [], past: [], morePast: false } }),
  );
  await page.route("**/api/admin/test-token/telegram", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/admin/test-token/settings", (r) => r.fulfill({ json: {} }));
  // On a wide screen the page sits beside its list with the site's top bar instead.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/test-token?tab=settings&sub=pay");
  const bar = page.locator(".sub-bar");
  await expect(bar).toContainText("收款设置");
  await page.evaluate(() => {
    (document.querySelector(".page") as HTMLElement).style.minHeight = "3000px";
  });
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(bar).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(bar).toBeInViewport();
});
