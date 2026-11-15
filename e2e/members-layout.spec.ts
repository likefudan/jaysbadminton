import { expect, test } from "@playwright/test";

/** 成员 on a phone: one slim line per member; what the Owner can do with them is on their page. */
test("member rows are one tappable line each, with the actions on the member's page", async ({ page }) => {
  const base = { wechatNickname: "", hasLink: false, adminNote: "", owingCents: 0, isOwner: false };
  const active = [
    { ...base, id: "M001", username: "Jay", wechatAccount: "jay_wx", hasLink: true, isOwner: true },
    {
      ...base,
      id: "M004",
      username: "carol3",
      wechatAccount: "carol3",
      applicantName: "carol3",
      googleEmail: "carol.long.address@gmail.com",
      isAdmin: true,
      isOrganizer: false,
    },
    { ...base, id: "M005", username: "Dan", wechatAccount: "dan_wx", isOrganizer: true },
    { ...base, id: "M006", username: "Eve", wechatAccount: "eve_wx" },
  ];
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (route) =>
    route.fulfill({
      json: {
        pending: [],
        active,
        inactive: [],
        deleted: [],
        organizers: { canManage: true, list: [], former: [] },
        viewer: {
          id: "M001",
          role: "owner",
          caps: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
        },
      },
    }),
  );
  await page.goto("/admin/test-token?tab=members");
  const row = page.locator(".member-row", { hasText: "carol3" });
  await expect(row.locator(".badge")).toHaveText("管理员");
  await expect(row).toContainText("微信：carol3");
  await expect(row).not.toContainText("gmail.com");
  await expect(page.locator(".member-row button")).toHaveCount(0);
  expect((await row.boundingBox())!.height).toBeLessThan(70);
  // Few members: no search box. Her page has the buttons.
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await row.click();
  const manage = page.locator(".member-manage");
  await expect(manage.getByRole("button", { name: "撤销管理员" })).toBeVisible();
  await expect(manage.getByRole("button", { name: "停用" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("the search box narrows a long member list as you type", async ({ page }) => {
  const base = { wechatNickname: "", hasLink: false, adminNote: "", owingCents: 0, isOwner: false };
  const active = Array.from({ length: 12 }, (_, i) => ({
    ...base,
    id: `M${String(i + 1).padStart(3, "0")}`,
    username: i === 5 ? "Lila" : `Player${i}`,
    wechatAccount: i === 7 ? "lil_wx" : `wx${i}`,
    googleEmail: "x@example.com",
    isOwner: i === 0,
  }));
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (route) =>
    route.fulfill({
      json: {
        pending: [],
        active,
        inactive: [],
        deleted: [],
        organizers: null,
        viewer: {
          id: "M001",
          role: "owner",
          caps: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
        },
      },
    }),
  );
  await page.goto("/admin/test-token?tab=members");
  await expect(page.locator(".member-row")).toHaveCount(12);
  await page.getByRole("searchbox", { name: "搜索名字或微信名" }).fill("LIL");
  await expect(page.locator(".member-row")).toHaveCount(2);
  await page.getByRole("searchbox").fill("nobody");
  await expect(page.getByText("没有找到成员")).toBeVisible();
});

/** An unfolded iPhone Duo held sideways (and tablets, computers): the list keeps the left half, the member opens in the right half. */
test("on a wide screen the list stays on the left and the member opens on the right", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 890, height: 626 }, locale: "zh-CN" });
  const page = await context.newPage();
  const base = { wechatNickname: "", hasLink: false, adminNote: "", owingCents: 0, isOwner: false };
  const active = Array.from({ length: 4 }, (_, i) => ({
    ...base,
    id: `M00${i + 1}`,
    username: `Player${i}`,
    wechatAccount: `wx${i}`,
    googleEmail: "x@example.com",
    isOwner: i === 0,
  }));
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (route) =>
    route.fulfill({
      json: {
        pending: [],
        active,
        inactive: [],
        deleted: [],
        organizers: null,
        viewer: {
          id: "M001",
          role: "owner",
          caps: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
        },
      },
    }),
  );
  await page.goto("/admin/test-token?tab=members");
  // No big 管理页 title; nothing open yet.
  await expect(page.locator(".hero")).toBeHidden();
  await expect(page.getByText("在左边选一位成员")).toBeVisible();
  const before = await page.evaluate(() => history.length);
  await page.locator(".member-row", { hasText: "Player1" }).click();
  await expect(page).toHaveURL(/member=M002/);
  // The list, the tabs and the top bar all stay; the member is in the right half.
  await expect(page.locator(".member-row")).toHaveCount(4);
  await expect(page.locator(".member-row", { hasText: "Player1" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".admin-tabs")).toBeVisible();
  const detail = page.locator(".md-detail");
  await expect(detail.getByRole("button", { name: "停用" })).toBeVisible();
  expect((await detail.boundingBox())!.x).toBeGreaterThan(440);
  expect((await page.locator(".md-list").boundingBox())!.width).toBeLessThan(440);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(890);
  // Another member takes the place of the first: one step back closes the right half.
  await page.locator(".member-row", { hasText: "Player2" }).click();
  await expect(page).toHaveURL(/member=M003/);
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  await detail.getByRole("button", { name: "成员" }).click();
  await expect(page.getByText("在左边选一位成员")).toBeVisible();
  await expect(page).not.toHaveURL(/member=/);
  await context.close();
});
