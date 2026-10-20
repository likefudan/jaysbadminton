import { expect, test } from "@playwright/test";

const event = (o: object) => ({
  id: 1,
  code: "JBM20261020",
  date: "2026-10-20",
  startTime: "20:30",
  endTime: "22:30",
  location: "Synergy Badminton Academy",
  address: "44380 Old Warm Springs Blvd, Fremont, CA 94538",
  title: "快乐星期二",
  deadlineAt: "2026-10-20T23:30:00Z",
  status: "open",
  headcount: 12,
  ...o,
});

/** 首页: the next event as one big card, 排行榜 and 历史活动 as rows that scroll sideways, not the page. */
test("the home page leads with the next event and scrolls the small cards sideways", async ({ page }) => {
  const names = ["arthur", "Dafei", "Jayx", "Johnzhang", "joseff", "Lily"];
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { signedIn: true, hasMember: true, pending: false } }),
  );
  await page.route("**/api/public/home", (route) =>
    route.fulfill({
      json: {
        currentEvents: [event({})],
        pastEvents: [1, 2, 3, 4].map((i) =>
          event({ id: 10 + i, code: `P${i}`, date: `2026-09-0${i}`, status: "settled" }),
        ),
        leaderboard: {
          year: 2026,
          attendance: names.map((name, i) => ({ rank: i + 1, name, value: 9 - i })),
          streak: [],
          friends: [],
        },
      },
    }),
  );
  await page.goto("/");
  const card = page.locator(".next-card");
  await expect(card.getByRole("link", { name: /快乐星期二/ })).toHaveAttribute("href", "/e/JBM20261020");
  await expect(card).toContainText("12 人已报名");
  await expect(card.getByRole("link", { name: "报名", exact: true })).toHaveAttribute("href", "/me");
  // The site name is only in the top bar now, not repeated as a big title.
  await expect(page.locator(".hero")).toHaveCount(0);

  const ranks = page.locator(".ranks-swipe");
  await expect(ranks.locator(".rank-card")).toHaveCount(6);
  const scrolls = await ranks.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator(".mini-card")).toHaveCount(4);

  await page.getByRole("button", { name: "最长连续" }).click();
  await expect(page.locator("main")).toContainText("还没有出勤记录");
});

/** 并列: people with the same count share a rank and its colour; the next rank skips. */
test("ties on the leaderboard share a rank", async ({ page }) => {
  const attendance = [
    { rank: 1, name: "Lily", value: 3 },
    { rank: 2, name: "arthur", value: 2 },
    { rank: 2, name: "Dafei", value: 2 },
    { rank: 2, name: "Jayx", value: 2 },
    { rank: 5, name: "Tom", value: 1 },
  ];
  await page.route("**/api/public/home", (route) =>
    route.fulfill({
      json: { currentEvents: [], pastEvents: [], leaderboard: { year: 2026, attendance, streak: [], friends: [] } },
    }),
  );
  await page.goto("/");
  const cards = page.locator(".ranks-swipe .rank-card");
  await expect(cards.locator(".rank-no")).toHaveText(["1", "2", "2", "2", "5"]);
  await expect(cards.nth(3)).toHaveClass(/\bp2\b/);
  await expect(cards.nth(4)).toHaveClass(/\bp5\b/);
});
