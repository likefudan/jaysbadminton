import { expect, test, type Page } from "@playwright/test";

/**
 * The app added to the home screen has its tabs at the bottom (Ke Li 2026-11-14): 活动 · 排行榜 ·
 * 我的, and 管理 for those who run events. A browser keeps the tabs at the top.
 */
const SHOTS = process.env.SHOTS;
const NAMES = ["Lina", "arturo", "Dawei", "Jayz", "Tom", "Kevin"];
const KEYS = ["calories", "attendance", "hours", "streak", "friends", "queue", "early", "progress"];
const list = NAMES.map((name, i) => ({ rank: i + 1, name, value: 30 - i * 3 }));
const leaderboard = {
  year: 2026,
  month: 11,
  boards: ["attendance"],
  ...Object.fromEntries(KEYS.map((k) => [k, []])),
  // 月度 is what shows first (Ke Li 2026-11-15).
  monthly: Object.fromEntries(KEYS.map((k) => [k, k === "attendance" ? list : []])),
};
const event = {
  id: 9,
  code: "26-1118",
  date: "2030-11-18",
  startTime: "20:00",
  endTime: "22:00",
  location: "Synergy Badminton Academy",
  address: "44380 Old Warm Springs Blvd, Fremont, CA 94538",
  title: "快乐星期二",
  notes: "",
  queueRoundMin: null,
  deadlineAt: "2030-11-18T01:00:00Z",
  status: "open",
  headcount: 14,
  myFriends: [],
  selfSignedUp: true,
  canEdit: true,
  friendCap: 2,
  organizer: "Jay",
  runByMe: false,
  managerName: "Jay",
  ownerName: "Jay",
  payment: null,
  roster: [{ name: "小明", friendOf: null, mine: true, absent: false }],
  queue: null,
  courts: [],
};

async function signedIn(page: Page, opts: { app: boolean; role?: string }) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        signedIn: true,
        hasMember: true,
        pending: false,
        email: "x@example.com",
        picture: null,
        role: opts.role ?? "member",
      },
    }),
  );
  await page.route("**/api/m/session/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "小明", wechatNickname: "xm", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({ json: { events: [event], history: [], friendCap: 2 } }),
  );
  await page.route("**/api/public/home", (route) =>
    route.fulfill({ json: { currentEvents: [event], pastEvents: [], leaderboard } }),
  );
  for (const path of ["profile", "stats", "push", "calories", "year"])
    await page.route(`**/api/m/session/${path}*`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  if (opts.app) await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
}

test("in the home-screen app the tabs are at the bottom", async ({ page }) => {
  await signedIn(page, { app: true });
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: "主导航" });
  await expect(tabs.getByRole("link")).toHaveText(["活动", "排行榜", "我的"]);
  await expect(tabs.getByRole("link", { name: "活动" })).toHaveAttribute("aria-current", "page");
  // The top tabs, the boards under the cards and the footer's links make way.
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await expect(page.locator(".page-tabs")).toBeHidden();
  await expect(page.locator(".board-block")).toBeHidden();
  await expect(page.locator(".legal-links")).toBeHidden();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-events.png` });

  await tabs.getByRole("link", { name: "排行榜" }).click();
  await expect(page).toHaveURL(/\/me\/boards$/);
  await expect(page.locator(".boards-page .podium")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "排行榜" })).toHaveAttribute("aria-current", "page");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-boards.png` });

  await tabs.getByRole("link", { name: "我的" }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  // 隐私政策 · 使用条款 · 外观 are under 我的.
  await expect(page.locator(".legal-links")).toBeVisible();
});

/**
 * The floating capsule slides down and the top bar up while the page is pushed up, and both come
 * back when it is pulled down (Ke Li 2026-11-18).
 */
test("the bars slide away while reading down and come back going up", async ({ page }) => {
  await signedIn(page, { app: true });
  await page.goto("/me");
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await page.evaluate(() => {
    (document.querySelector(".page") as HTMLElement).style.minHeight = "3000px";
  });
  const html = page.locator("html");
  const topbar = page.locator(".topbar");
  const shown = async () => {
    await expect(html).not.toHaveClass(/bars-away/);
    await expect(topbar).toBeInViewport();
  };
  await shown();
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(html).toHaveClass(/bars-away/);
  await expect(topbar).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 300));
  await shown();
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(html).toHaveClass(/bars-away/);
  // The top bar stays while its menu is open.
  await page.getByRole("button", { name: /Google 账号/ }).evaluate((b) => b.setAttribute("aria-expanded", "true"));
  await expect(topbar).toBeInViewport();
  await page.getByRole("button", { name: /Google 账号/ }).evaluate((b) => b.setAttribute("aria-expanded", "false"));
  // Back near the top they always show.
  await page.evaluate(() => window.scrollTo(0, 0));
  await shown();
});

test("in a browser the top bar slides away too", async ({ page }) => {
  await signedIn(page, { app: false });
  await page.goto("/me");
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await page.evaluate(() => {
    (document.querySelector(".page") as HTMLElement).style.minHeight = "3000px";
  });
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator(".topbar")).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(page.locator(".topbar")).toBeInViewport();
});

test("those who run events get a 管理 tab instead of 切换为管理员", async ({ page }) => {
  await signedIn(page, { app: true, role: "organizer" });
  await page.goto("/me");
  const tabs = page.getByRole("navigation", { name: "主导航" });
  await expect(tabs.getByRole("link")).toHaveText(["活动", "排行榜", "我的", "管理"]);
  await expect(tabs.getByRole("link", { name: "管理" })).toHaveAttribute("href", "/admin/google");
  await page.getByRole("button", { name: /Google 账号/ }).click();
  await expect(page.getByRole("link", { name: "切换为管理员" })).toHaveCount(0);
  if (SHOTS) {
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${SHOTS}/3-manager.png` });
  }
});

/** The tabs are the only way around in the app: the avatar menu keeps just 外观 and 退出登录 (Ke Li 2026-11-17). */
test("in the home-screen app the avatar menu has no page links", async ({ page }) => {
  await signedIn(page, { app: true });
  await page.goto("/me");
  await page.getByRole("button", { name: /Google 账号/ }).click();
  const menu = page.getByRole("region", { name: "Google 账号信息" });
  await expect(menu.getByRole("button", { name: "外观" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "退出登录" })).toBeVisible();
  await expect(menu.getByRole("link")).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-app.png` });
});

test("in a browser the avatar menu keeps its page links", async ({ page }) => {
  await signedIn(page, { app: false });
  await page.goto("/me");
  await page.getByRole("button", { name: /Google 账号/ }).click();
  const menu = page.getByRole("region", { name: "Google 账号信息" });
  await expect(menu.getByRole("link")).toHaveText(["我的活动", "个人信息"]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-browser.png` });
});

test("a browser keeps the tabs at the top", async ({ page }) => {
  await signedIn(page, { app: false, role: "organizer" });
  await page.goto("/");
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await expect(page.locator(".page-tabs")).toBeVisible();
  await expect(page.locator(".board-block")).toBeVisible();
  await page.getByRole("button", { name: /Google 账号/ }).click();
  await expect(page.getByRole("link", { name: "切换为管理员" })).toBeVisible();
});

/** The number on the home-screen icon: the events waiting for this member's payment. */
test("the icon's badge counts the bills still to pay", async ({ page }) => {
  await signedIn(page, { app: true });
  const billed = {
    ...event,
    id: 10,
    code: "26-1110",
    date: "2026-11-10",
    status: "finalized",
    canEdit: false,
    payment: {
      amountCents: 2392,
      paidCents: 0,
      refundCents: 0,
      status: "unpaid",
      code: "E2",
      shares: [{ name: "小明", friendIndex: 0, attended: true, courtCents: 2000, shuttleCents: 392 }],
      payeeName: "Jay",
      venmoUsername: "jay",
      zelleAccount: "",
    },
  };
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({ json: { events: [event, billed], history: [], friendCap: 2 } }),
  );
  await page.addInitScript(() => {
    const w = window as { badge?: number };
    Object.assign(navigator, {
      setAppBadge: async (n: number) => {
        w.badge = n;
      },
      clearAppBadge: async () => {
        w.badge = 0;
      },
    });
  });
  await page.goto("/me");
  await expect(page.locator(".ev-card").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as { badge?: number }).badge)).toBe(1);
});
