import { expect, test } from "@playwright/test";

/** 设置 → 版本和更新记录 (src/web/pages/AdminVersions.tsx), for the Owner and for an organizer. */

const RELEASES = {
  current: "v2026.11.10",
  releases: [
    {
      tag: "v2026.11.10",
      at: "2026-11-10T09:11:00Z",
      lines: { "zh-CN": ["名单默认收起。"], "zh-TW": ["名單預設收起。"], en: ["The roster starts folded."] },
      changes: [],
    },
    { tag: "v2026.11.09", at: "2026-11-10T01:58:00Z", lines: null, changes: ["新建活动的开关合成一个列表"] },
    { tag: "v2026.11.07", at: "2026-11-07T10:05:00Z", lines: { "zh-CN": [], "zh-TW": [], en: [] }, changes: [] },
  ],
};

async function mock(page: import("@playwright/test").Page, role: "owner" | "organizer") {
  const T = "**/api/admin/test-token/";
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route(`${T}members`, (r) =>
    r.fulfill({
      json: {
        pending: [],
        active: [],
        inactive: [],
        deleted: [],
        viewer: { role, caps: role === "owner" ? ["owner"] : [] },
      },
    }),
  );
  await page.route(`${T}events?*`, (r) => r.fulfill({ json: { current: [], past: [], morePast: false } }));
  await page.route(`${T}telegram`, (r) => r.fulfill({ json: {} }));
  await page.route(`${T}settings`, (r) => r.fulfill({ json: {} }));
  await page.route(`${T}payment-profile`, (r) => r.fulfill({ json: {} }));
  await page.route(`${T}releases`, (r) => r.fulfill({ json: RELEASES }));
}

for (const role of ["owner", "organizer"] as const) {
  test(`版本和更新记录 (${role})`, async ({ page }) => {
    await mock(page, role);
    await page.goto("/admin/test-token?tab=settings");
    const row = page.getByRole("button", { name: /^版本和更新记录/ });
    await expect(row).toContainText("v2026.11.10");
    await row.click();
    await expect(page).toHaveURL(/sub=versions$/);
    await expect(page.locator(".ver-now")).toContainText("v2026.11.10");
    await expect(page.locator(".ver-now")).toContainText("2026年11月10日发布");
    const items = page.locator(".ver-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("当前");
    await expect(items.nth(0)).toContainText("名单默认收起。");
    await expect(items.nth(1)).toContainText("新建活动的开关合成一个列表");
    await expect(items.nth(2)).toContainText("只是内部改进");
    await page.locator(".sub-bar").getByRole("button", { name: "设置" }).click();
    await expect(page).toHaveURL(/\?tab=settings$/);
  });
}
