import { test, expect } from "@playwright/test";

for (const role of ["owner", "organizer"] as const) {
  test(`${role} switches to their own member page, signs up and switches back`, async ({ page }, testInfo) => {
    let signedUp = false;
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { signedIn: true, email: "manager@gmail.com", hasMember: true, pending: false, role } }),
    );
    await page.route("**/api/admin/google/members", (route) =>
      route.fulfill({
        json: {
          active: [],
          inactive: [],
          deleted: [],
          pending: [],
          organizers: null,
          viewer: {
            id: "M007",
            role,
            caps:
              role === "owner"
                ? ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"]
                : ["events.create", "event", "payee", "members.read", "self"],
          },
        },
      }),
    );
    await page.route("**/api/admin/google/events**", (route) =>
      route.fulfill({ json: { current: [], past: [], morePast: false } }),
    );
    await page.route("**/api/m/session/me", (route) =>
      route.fulfill({
        json: { id: "M007", username: "Manager", active: true, canAdmin: true, isOwner: role === "owner" },
      }),
    );
    const event = {
      id: 42,
      code: "OTHER",
      date: "2030-10-15",
      startTime: "19:00",
      endTime: "21:00",
      location: "Other Gym",
      address: "",
      title: "其他管理员的活动",
      status: "open",
      deadlineAt: "2030-10-14T02:00:00Z",
      headcount: 1,
      organizer: "Other manager",
      canEdit: true,
      payment: null,
      roster: null,
    };
    await page.route("**/api/m/session/events", (route) =>
      route.fulfill({
        json: {
          events: [{ ...event, myFriends: signedUp ? [] : null, selfSignedUp: signedUp, friendCap: 3, runByMe: false }],
          history: [],
          friendCap: 3,
        },
      }),
    );
    await page.route("**/api/m/session/events/42/signup", (route) => {
      expect(route.request().postDataJSON()).toEqual({ friends: [], guests: [] });
      signedUp = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/admin/google");
    await page.getByRole("link", { name: "切换为普通成员", exact: true }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { name: "你好，Manager" })).toBeVisible();
    await page.getByRole("button", { name: "报名", exact: true }).click();
    await page.getByRole("button", { name: "确认报名" }).click();
    await expect(page.locator(".status-mine")).toHaveText("我已报名");
    await page.screenshot({ path: testInfo.outputPath(`member-view-${role}.png`) });
    await page.getByRole("link", { name: "切换为管理员", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/google$/);
    await expect(page.getByRole("link", { name: "切换为普通成员", exact: true })).toBeVisible();
  });
}

test("ordinary members have no administrator profile switch", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { signedIn: true, email: "member@gmail.com", hasMember: true, role: "member" } }),
  );
  await page.goto("/privacy");
  await expect(page.getByRole("button", { name: "Google 账号：member@gmail.com" })).toBeVisible();
  await expect(page.locator(".profile-switch")).toHaveCount(0);
});
