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
  const names = ["arthur", "Dafei", "Jayx", "Johnzhang", "joseff", "Lily", "Tom", "Kevin"];
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
          calories: [],
        },
      },
    }),
  );
  await page.goto("/");
  const card = page.locator(".next-card");
  await expect(card.getByRole("link", { name: /快乐星期二/ })).toHaveAttribute("href", "/e/JBM20261020");
  await expect(card).toContainText("12 人已报名");
  // 报名 opens the same page as the card itself: the event's own card.
  await expect(card.getByRole("link", { name: "报名", exact: true })).toHaveAttribute("href", "/e/JBM20261020");
  // The site name is only in the top bar now, not repeated as a big title.
  await expect(page.locator(".hero")).toHaveCount(0);

  // 能量 is the first board and the one shown first (Ke Li).
  const tabs = page.locator(".board-tabs button");
  await expect(tabs).toHaveText(["能量", "出勤次数", "最长连续", "带朋友"]);
  await expect(tabs.first()).toHaveClass(/\bon\b/);
  await expect(page.locator("main")).toContainText("还没有人加入能量榜");
  await page.getByRole("button", { name: "出勤次数" }).click();
  // A podium for the top three (2nd, 1st, 3rd from the left), rows below it, the rest behind 查看全部.
  await expect(page.locator(".podium .who")).toHaveText(["Dafei", "arthur", "Jayx"]);
  await expect(page.locator(".podium .crown")).toHaveCount(1);
  const rows = page.locator(".board-rows li");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "查看全部 8 人" }).click();
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText("Kevin");
  await page.getByRole("button", { name: "收起" }).click();
  await expect(rows).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator(".mini-card")).toHaveCount(4);

  await page.getByRole("button", { name: "最长连续" }).click();
  await expect(page.locator("main")).toContainText("还没有出勤记录");
});

/** Signed in: every current event in the same card, soonest first, coloured as on 我的活动 (Ke Li). */
test("signed in, each event gets the same card, soonest first, coral for the ones I'm on", async ({ page }) => {
  const closed = event({ id: 2, code: "C2", date: "2026-10-19", title: "上周二", status: "closed" });
  const mineOpen = event({});
  const other = event({ id: 3, code: "C3", date: "2026-10-27", title: "下周二" });
  const own = (e: object, on: boolean) => ({
    ...e,
    selfSignedUp: on,
    myFriends: on ? [] : null,
    payment: null,
    courts: [],
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { signedIn: true, hasMember: true, pending: false } }),
  );
  await page.route("**/api/public/home", (route) =>
    route.fulfill({ json: { currentEvents: [closed, mineOpen, other], pastEvents: [], leaderboard: null } }),
  );
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({
      json: { events: [own(closed, true), own(mineOpen, true), own(other, false)], history: [], friendCap: 3 },
    }),
  );
  await page.goto("/");
  const cards = page.locator(".next-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".hero-what")).toHaveText([/上周二/, /快乐星期二/, /下周二/]);
  await expect(cards.nth(0)).toHaveClass(/tone-hero/);
  await expect(cards.nth(1)).toHaveClass(/tone-hero/);
  await expect(cards.nth(2)).toHaveClass(/tone-soft/);
  await expect(cards.locator(".next-cta")).toHaveText(["查看 →", "查看 →", "报名 →"]);
  await expect(page.getByText("近期活动")).toHaveCount(0);
});

/** Signed out: no button on the event card, one 登录 / 注册 for the page, in the top bar (Ke Li). */
test("signed out, the card has no button and the page has one 登录 / 注册", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/public/home", (route) =>
    route.fulfill({ json: { currentEvents: [event({})], pastEvents: [], leaderboard: null } }),
  );
  await page.goto("/");
  const card = page.locator(".next-card");
  await expect(card).toContainText("12 人已报名");
  await expect(card.locator(".next-cta")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "登录 / 注册" })).toHaveCount(1);
  await expect(page.locator(".topbar").getByRole("link", { name: "登录 / 注册" })).toHaveAttribute("href", "/me");
});

/** The AI sponsor thanked under 隐私政策 · 使用条款 on every page, linked to their site (Ke Li, option A). */
test("the footer thanks the AI sponsor", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/public/home", (route) =>
    route.fulfill({ json: { currentEvents: [event({})], pastEvents: [], leaderboard: null } }),
  );
  await page.goto("/");
  const line = page.locator(".legal-links .sponsor");
  await expect(line).toHaveText("♥ AI 服务由 Z3 Enterprise 赞助");
  await expect(line.getByRole("link", { name: "Z3 Enterprise" })).toHaveAttribute(
    "href",
    "https://www.z3enterprise.com/",
  );
  await page.locator(".legal-links").screenshot({ path: test.info().outputPath("sponsor-footer.png") });
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
      json: {
        currentEvents: [],
        pastEvents: [],
        leaderboard: { year: 2026, attendance, streak: [], friends: [], calories: [] },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "出勤次数" }).click();
  // The podium shows 2nd, 1st, 3rd from the left; tied places share a number.
  await expect(page.locator(".podium .step")).toHaveText(["2", "1", "2"]);
  await expect(page.locator(".podium .place").nth(2)).toHaveClass(/\bp2\b/);
  await expect(page.locator(".board-rows .rank-no")).toHaveText(["2", "5"]);
});

test.describe("with a mouse", () => {
  test.use({ viewport: { width: 1200, height: 900 }, isMobile: false, hasTouch: false });

  /** 电脑: ‹ › beside the heading turn a page, and the row can be dragged without opening a card. */
  test("the sideways rows get arrows and can be dragged", async ({ page }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
    await page.route("**/api/public/home", (route) =>
      route.fulfill({
        json: {
          currentEvents: [event({})],
          pastEvents: Array.from({ length: 8 }, (_, i) =>
            event({ id: 10 + i, code: `P${i}`, date: `2026-09-0${i + 1}`, status: "settled" }),
          ),
          leaderboard: {
            year: 2026,
            attendance: [],
            streak: [],
            friends: [],
            calories: [{ name: "arthur", value: 1522, rank: 1 }],
          },
        },
      }),
    );
    await page.goto("/");
    const head = page.locator(".section-title", { hasText: "历史活动" });
    const row = page.locator(".swipe:has(.mini-card)");
    const left = () => row.evaluate((el) => el.scrollLeft);
    await expect(head.getByRole("button", { name: "上一页" })).toBeDisabled();
    await head.getByRole("button", { name: "下一页" }).click();
    await expect.poll(left).toBeGreaterThan(100);
    await expect(head.getByRole("button", { name: "上一页" })).toBeEnabled();
    // The leaderboard is a podium now, not a sideways row: no arrows.
    await expect(page.locator(".section-title", { hasText: "排行榜" }).locator(".swipe-arrows")).toHaveCount(0);

    // Drag back to the start; letting go on a card doesn't open it.
    const box = (await row.boundingBox())!;
    const before = await left();
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await left()).toBeLessThan(before);
    await expect(page).toHaveURL(/\/$/);
  });
});

test("phones get no arrows, just the swipe", async ({ page }) => {
  await page.route("**/api/public/home", (route) =>
    route.fulfill({
      json: {
        currentEvents: [],
        pastEvents: Array.from({ length: 8 }, (_, i) => event({ id: 10 + i, code: `P${i}`, status: "settled" })),
        leaderboard: null,
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".mini-card")).toHaveCount(8);
  await expect(page.locator(".swipe-arrows")).toBeHidden();
});
