import { expect, test } from "@playwright/test";

/** 我的统计 on the 个人信息 page, with a fixed history so the numbers are known. */
test("the member picks a range and the spending chart and figures follow", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  // Counted in calendar days from today's date, so the hour lost or gained at a DST change can't shift it.
  const daysAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
  const entry = (date: string, cents: number, attended = true) => ({
    date,
    title: "",
    location: "Synergy",
    cents,
    attended,
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dafei", wechatNickname: "dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.route("**/api/m/tok/profile", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "x" } } }),
  );
  await page.route("**/api/m/tok/stats", (route) =>
    route.fulfill({
      json: {
        year: 2026,
        yearCount: 0,
        totalCount: 4,
        yearSpendCents: 0,
        avgSpendCents: 0,
        lastYearCount: 0,
        lastYearSpendCents: 0,
        today,
        history: [
          entry(daysAgo(300), 1000),
          entry(daysAgo(40), 2000, false),
          entry(daysAgo(10), 1500),
          entry(daysAgo(2), 1200),
        ],
      },
    }),
  );
  await page.goto("/m/tok/profile");
  const card = page.locator(".card.spend");
  const figures = card.locator(".spend-figures");

  await card.getByRole("button", { name: "ALL" }).click();
  await expect(figures).toContainText("3次");
  await expect(figures).toContainText("$57.00");
  await expect(figures).toContainText("$19.00"); // $57 over 3 visits (the absent one is billed, not counted)

  await card.getByRole("button", { name: "7D" }).click();
  await expect(figures).toContainText("1次");
  await expect(figures).toContainText("$12.00");
  await expect(card.locator(".spend-col")).toHaveCount(7);
  await expect(card.locator(".spend-bar")).toHaveCount(1);

  // Tapping a column reads it out; 明细 lists the events in the range.
  await card.locator(".spend-col").nth(4).click();
  await expect(card.locator(".spend-readout")).toContainText("花费 $12.00 · 打球 1 次");
  await card.getByText("明细（1 场）").click();
  await expect(card.locator(".spend-detail td.num")).toHaveText(["$12.00"]);

  await card.getByRole("button", { name: "30D" }).click();
  await expect(figures).toContainText("2次");
  await expect(figures).toContainText("$27.00");

  // The choice is remembered.
  await page.reload();
  await expect(page.locator(".card.spend").getByRole("button", { name: "30D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
