import { expect, test } from "@playwright/test";

/** 成员 on a phone: buttons go below the name instead of squeezing it to one character a line. */
test("member rows keep the name and details readable on a phone", async ({ page }) => {
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
  const row = page.locator(".row", { hasText: "carol3" });
  await expect(row.getByRole("button", { name: "撤销管理员" })).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  const whoBox = (await row.locator(".who").boundingBox())!;
  expect(whoBox.width).toBeGreaterThan(rowBox.width * 0.9);
  const badge = (await row.locator(".badge").boundingBox())!;
  expect(badge.height).toBeLessThan(30);
  // The Owner's two buttons still fit beside the name.
  const owner = page.locator(".row", { hasText: "Jay" });
  const ownerWho = (await owner.locator(".who").boundingBox())!;
  const ownerActions = (await owner.locator(".actions").boundingBox())!;
  expect(ownerActions.y).toBeLessThan(ownerWho.y + ownerWho.height);
});
