import { expect, test, type Page } from "@playwright/test";
import { drawWinners, sha256Hex } from "../src/shared/lottery";

/**
 * 抽奖 (Ke Li 2026-11-16, option C 百人头像墙): members see it on 我的活动 and watch the draw on a
 * wall of faces; the Owner and admins set it up, 预演 it, lock it and press 开奖 in 设置 → 抽奖.
 */
const SHOTS = process.env.UI_REVIEW_SCREENSHOTS;
/** A screenshot for review, once the panel has finished sliding in. */
const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
const COLORS = ["#d38a6c", "#6d8fb0", "#6f9a7e", "#9686b8", "#c9952b", "#c2706a", "#5f9ea0", "#8a7d6b"];
const NAMES = ["Amy", "Ben", "Coco", "Dan", "Eve", "Fay", "Gus", "Ivy", "Jo", "Kai", "Leo", "Mia", "Ned", "Oli"];
const face = (i: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${COLORS[i % COLORS.length]}"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${NAMES[i % NAMES.length]![0]}</text></svg>`,
  )}`;
const entries = Array.from({ length: 100 }, (_, i) => ({
  rank: i + 1,
  id: `M${String(i + 1).padStart(3, "0")}`,
  name: i === 36 ? "Ke" : `${NAMES[i % NAMES.length]}${i + 1}`,
  // A few without a photo: the wall shows their first letter.
  avatar: i % 9 === 4 ? null : face(i),
  online: i % 5 !== 2,
  // A few have been cheering.
  cheers: i === 7 ? 40 : i === 20 ? 25 : i === 36 ? 3 : i % 11 === 0 ? 2 : 0,
}));
const prizes = [
  { name: "亚3", count: 3 },
  { name: "黑航空", count: 2 },
];
const winners = [
  { drawNo: 1, rank: 82, prize: "亚3" },
  { drawNo: 2, rank: 5, prize: "亚3" },
  { drawNo: 3, rank: 61, prize: "亚3" },
  { drawNo: 4, rank: 64, prize: "黑航空" },
  { drawNo: 5, rank: 19, prize: "黑航空" },
];

const view = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "百人庆祝抽奖",
  poolSize: 100,
  prizes,
  drawAt: new Date(Date.now() + (30 * 3600 + 42 * 60) * 1000).toISOString(),
  status: "open",
  seedHash: "9f3a61c20be47d18a07e9f3a61c20be47d18a07e9f3a61c20be47d18a07e9f3a",
  seed: null,
  drawnAt: null,
  host: null,
  now: new Date().toISOString(),
  entries,
  winners: [],
  draws: 5,
  me: { id: "M037", rank: 37, inPool: true, cheers: 3, optedOut: false, canOpt: true },
  watching: 81,
  cheers: 213,
  locked: false,
  rehearsal: false,
  ...over,
});

async function member(page: Page, lottery: () => object | null) {
  const cheers: number[] = [];
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (r) =>
    r.fulfill({ json: { id: "M037", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/tok/events", (r) => r.fulfill({ json: { events: [], history: [] } }));
  await page.route("**/api/m/tok/lottery", (r) => r.fulfill({ json: { lottery: lottery() } }));
  await page.route("**/api/m/tok/lottery/cheer", (r) => {
    cheers.push(r.request().postDataJSON().n);
    return r.fulfill({
      json: { cheers: 213 + cheers.reduce((a, b) => a + b, 0), mine: 3 + cheers.reduce((a, b) => a + b, 0) },
    });
  });
  return cheers;
}

test("a member sees the 抽奖 on 我的活动, their number, and cheers", async ({ page }) => {
  const cheers = await member(page, () => view());
  await page.goto("/m/tok");
  const card = page.getByRole("button", { name: /百人庆祝抽奖/ });
  await expect(card).toContainText("你的抽奖号 037");
  await shot(page, "lottery-0-card");
  await card.click();
  const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
  await expect(panel).toContainText("前 100 名入群的球友，抽 5 位幸运儿");
  await expect(panel).toContainText("你的抽奖号 037");
  await expect(panel).toContainText("亚3 ×3");
  // 热度 and who cheers most; no 公平公开, no lines of small print.
  await expect(panel).toContainText("热度 Lv.4");
  await expect(panel.locator(".lot-top")).toContainText("Ivy8");
  await expect(panel).not.toContainText("公平公开");
  await expect(panel).not.toContainText("不影响中奖");
  await expect(panel.locator(".lot-face")).toHaveCount(100);
  await expect(panel.locator(".lot-face.me")).toHaveCount(1);
  await shot(page, "lottery-1-lobby");
  const cheer = panel.getByRole("button", { name: /打气/ });
  await cheer.click();
  await cheer.click();
  await cheer.click();
  // Their own face jumps on the wall at once; the count is theirs.
  await expect(panel.locator(".lot-face.me.cheer")).toHaveCount(1);
  await expect(cheer).toContainText("×6");
  await expect(panel.locator(".lot-heat-n")).toContainText("216");
  await shot(page, "lottery-1b-cheer");
  await expect.poll(() => cheers).toEqual([3]);
});

test("a member sits the 抽奖 out from the card, and comes back", async ({ page }) => {
  let out = false;
  const posts: boolean[] = [];
  const mine = () =>
    view({
      entries: out ? entries.filter((e) => e.id !== "M037") : entries,
      me: { id: "M037", rank: 37, inPool: !out, cheers: 0, optedOut: out, canOpt: true },
    });
  await member(page, mine);
  await page.route("**/api/m/tok/lottery/opt", (r) => {
    out = r.request().postDataJSON().out;
    posts.push(out);
    return r.fulfill({ json: { lottery: mine() } });
  });
  page.on("dialog", (d) => void d.accept());
  await page.goto("/m/tok");
  const card = page.locator(".lot-ev");
  await expect(card).toContainText("你的抽奖号 037");
  await card.getByRole("button", { name: "不参加这次抽奖" }).click();
  await expect(card).toContainText("你已选择不参加");
  await expect(card).not.toContainText("你的抽奖号");
  await shot(page, "lottery-0b-opted-out");
  await card.getByRole("button", { name: "重新参加" }).click();
  await expect(card).toContainText("你的抽奖号 037");
  expect(posts).toEqual([true, false]);
});

test("the faces on the wall change places while everyone waits", async ({ page }) => {
  // The page's clock is run forward; the server's answers keep up with it.
  let ahead = 0;
  await page.clock.install();
  await member(page, () => view({ now: new Date(Date.now() + ahead).toISOString() }));
  await page.goto("/m/tok?lottery=1");
  const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
  await expect(panel.locator(".lot-face")).toHaveCount(100);
  const order = () => panel.locator(".lot-face small").allTextContents();
  const before = await order();
  ahead = 13_000;
  await page.clock.runFor(13_000);
  await expect.poll(order).not.toEqual(before);
  expect([...(await order())].sort()).toEqual([...before].sort());
});

test("everyone watches the shuttle land on each winner, then can check the result", async ({ page }) => {
  // The 4th draw is in the air: three winners up, the shuttle hopping.
  const drawnAt = Date.now() - (5_000 + 3 * 15_000 + 3_000);
  await member(page, () => {
    const now = Date.now();
    return view({
      status: "drawn",
      drawnAt: new Date(drawnAt).toISOString(),
      host: "Jay",
      now: new Date(now).toISOString(),
      winners: winners.filter((w) => drawnAt + 5_000 + (w.drawNo - 1) * 15_000 <= now),
    });
  });
  await page.goto("/m/tok?lottery=1");
  const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
  await expect(panel).toContainText("直播开奖中 · 81 人在看");
  await expect(panel).toContainText("第 4 / 5 次 · 黑航空");
  await expect(panel.locator(".lot-face.won")).toHaveCount(3);
  await expect(panel.locator(".lot-shuttle svg")).toBeVisible();
  // Somebody's racket is hitting it.
  await expect(panel.locator(".lot-racket")).toHaveCount(1);
  await shot(page, "lottery-2-live");
  // It lands on Ned64.
  await expect(panel).toContainText("落在了 064 号", { timeout: 10_000 });
  await shot(page, "lottery-3-landed");
  if (SHOTS) {
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "lottery-3-landed-dark");
  }
});

// For review only: a video of one whole draw (the rally, the smash, the landing), in test-results.
const VIDEO = !!process.env.LOTTERY_VIDEO;
test.use({ video: VIDEO ? { mode: "on", size: { width: 390, height: 844 } } : "off" });
test.describe("for review", () => {
  test("a video of one draw", async ({ page }) => {
    test.skip(!VIDEO, "only with LOTTERY_VIDEO=1");
    test.setTimeout(60_000);
    const drawnAt = Date.now() + 3_000 - 5_000;
    await member(page, () => {
      const now = Date.now();
      return view({
        status: "drawn",
        drawnAt: new Date(drawnAt).toISOString(),
        host: "Jay",
        now: new Date(now).toISOString(),
        winners: winners.filter((w) => drawnAt + 5_000 + (w.drawNo - 1) * 15_000 <= now),
      });
    });
    await page.goto("/m/tok?lottery=1");
    const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
    await expect(panel.locator(".lot-face")).toHaveCount(100);
    await expect(panel).toContainText("落在了 082 号", { timeout: 20_000 });
    await page.waitForTimeout(3_000);
  });

  test("a video of the wall changing places", async ({ page }) => {
    test.skip(!VIDEO, "only with LOTTERY_VIDEO=1");
    test.setTimeout(60_000);
    await member(page, () => view({ now: new Date().toISOString() }));
    await page.goto("/m/tok?lottery=1");
    const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
    await expect(panel.locator(".lot-face")).toHaveCount(100);
    await panel.locator(".lot-wall").scrollIntoViewIfNeeded();
    await page.waitForTimeout(27_000);
  });
});

test("after the draw: the winners, and one's own place", async ({ page }) => {
  // A real seed, and the winners it gives for 1–100 (shared/lottery.ts drawWinners).
  const seed = "a".repeat(64);
  const hash = await sha256Hex(seed);
  const ranks = await drawWinners(
    seed,
    entries.map((e) => e.rank),
    5,
  );
  await member(page, () =>
    view({
      status: "drawn",
      drawnAt: new Date(Date.now() - 600_000).toISOString(),
      host: "Jay",
      seed,
      seedHash: hash,
      winners: winners.map((w, i) => ({ ...w, rank: ranks[i]! })),
      me: { id: "M113", rank: 113, inPool: false, cheers: 0 },
    }),
  );
  await page.goto("/m/tok?lottery=1");
  const panel = page.getByRole("dialog", { name: "百人庆祝抽奖" });
  await expect(panel).toContainText("开奖结果");
  await expect(panel).toContainText("请中奖的球友联系 Jay 领奖");
  await expect(panel).toContainText("你是第 113 位入群的球友");
  await expect(panel).not.toContainText("下一站");
  await expect(panel.locator(".lot-winners li")).toHaveCount(5);
  await shot(page, "lottery-4-result");
});

const API = "**/api/admin/test-token";

async function admin(page: Page, current: () => object | null, canLock = true, excluded: object[] = []) {
  const posts: { url: string; body: any }[] = [];
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route(`${API}/members`, (r) =>
    r.fulfill({ json: { pending: [], active: [], inactive: [], deleted: [], viewer: { caps: ["owner"] } } }),
  );
  await page.route(`${API}/events?*`, (r) => r.fulfill({ json: { current: [], past: [], morePast: false } }));
  await page.route(`${API}/telegram`, (r) => r.fulfill({ json: {} }));
  await page.route(`${API}/settings`, (r) => r.fulfill({ json: {} }));
  await page.route(`${API}/lottery?*`, (r) =>
    r.fulfill({
      json: { current: current(), preview: current() ? [] : entries, excluded, members: 128, pushMembers: 64, canLock },
    }),
  );
  await page.route(`${API}/lottery/history?*`, (r) =>
    r.fulfill({
      json: {
        history: [
          {
            id: 7,
            title: "中秋抽奖",
            status: "drawn",
            poolSize: 100,
            prizes,
            drawAt: "2026-09-25T03:00:00.000Z",
            createdAt: "2026-09-20T03:00:00.000Z",
            host: "Jay",
            seed: "c".repeat(64),
            seedHash: "d".repeat(64),
            entries: entries.slice(1).map((e) => ({ rank: e.rank, name: e.name })),
            excluded: [{ rank: 1, name: "Amy1" }],
            winners: winners.map((w) => ({ ...w, name: entries[w.rank - 1]!.name })),
          },
        ],
      },
    }),
  );
  await page.route(`${API}/lottery/**`, (r) => {
    if (r.request().method() === "GET") return r.fallback();
    const url = new URL(r.request().url()).pathname;
    const body = r.request().postDataJSON();
    posts.push({ url, body });
    if (url.endsWith("/rehearse"))
      return r.fulfill({
        json: {
          view: view({
            rehearsal: true,
            status: "drawn",
            drawnAt: new Date().toISOString(),
            host: "Jay",
            winners,
            me: null,
            seed: "b".repeat(64),
          }),
          checks: {
            entries: 98,
            excluded: 2,
            poolSize: 100,
            noAvatar: 12,
            pushMembers: 64,
            myDevices: 2,
            telegram: true,
          },
        },
      });
    return r.fulfill({ json: { ok: true } });
  });
  await page.route(`${API}/lottery`, (r) => {
    posts.push({ url: "/lottery", body: r.request().postDataJSON() });
    return r.fulfill({ json: { ok: true } });
  });
  return posts;
}

test("设置 → 抽奖: set one up, rehearse it (only for whoever pressed), then publish", async ({ page }) => {
  const posts = await admin(page, () => null);
  await page.goto("/admin/test-token?tab=settings&sub=lottery");
  await expect(page.getByText("现在的前 100 名：100 人")).toBeVisible();
  await page.getByLabel("奖品名称").fill("亚3");
  await page.getByLabel("数量").fill("3");
  await page.getByRole("button", { name: "＋ 再加一种奖品" }).click();
  await page.getByLabel("奖品名称").nth(1).fill("黑航空");
  await page.getByLabel("数量").nth(1).fill("2");
  await expect(page.getByLabel("下一站")).toHaveCount(0);
  // 历次抽奖: who took part, the prizes, the winners and the random number.
  await page.getByRole("button", { name: /中秋抽奖/ }).click();
  const record = page.getByRole("dialog", { name: "中秋抽奖" });
  await expect(record).toContainText("参加的 99 人");
  await expect(record).toContainText("不参加的 1 人");
  await expect(record).toContainText("c".repeat(64));
  await expect(record.locator(".lot-winners li")).toHaveCount(5);
  await shot(page, "lottery-9-record");
  await record.getByRole("button", { name: /返回/ }).click();
  // Two of the first 100 won't take part.
  await page.getByRole("button", { name: "查看名单，选不参加的人" }).click();
  const list = page.getByRole("dialog", { name: "抽奖名单" });
  await list.getByRole("checkbox", { name: "Ben2 参加" }).uncheck();
  await list.getByRole("checkbox", { name: "Dan4 参加" }).uncheck();
  await expect(list).toContainText("98 人参加");
  await shot(page, "lottery-8-exclude");
  await list.getByRole("button", { name: /返回/ }).click();
  await expect(page.getByText("，去掉 2 人，98 人参加")).toBeVisible();
  await shot(page, "lottery-5-setup", true);
  await page.getByRole("button", { name: "预演一遍（只有你看得到）" }).first().click();
  const panel = page.getByRole("dialog", { name: "预演" });
  await expect(panel).toContainText("预演 · 只有你看得到，不算数");
  await expect(panel).toContainText("12 人没有头像");
  await expect(panel).toContainText("（2 人不参加）");
  await expect(panel).toContainText("预演推送已发到你的 2 台设备");
  expect(posts[0]).toMatchObject({
    url: "/api/admin/test-token/lottery/rehearse",
    body: {
      poolSize: 100,
      prizes: [
        { name: "亚3", count: 3 },
        { name: "黑航空", count: 2 },
      ],
      exclude: ["M002", "M004"],
    },
  });
  await expect(panel).toContainText("第 1 / 5 次", { timeout: 10_000 });
  await shot(page, "lottery-6-rehearsal");
  await panel.getByRole("button", { name: /返回/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "公布抽奖" }).click();
  await expect.poll(() => posts.map((p) => p.url)).toContain("/lottery");
});

test("设置 → 抽奖: the Owner locks it; locked, it can't be changed or cancelled, it still draws on time", async ({
  page,
}) => {
  let locked = true;
  const posts = await admin(page, () => view({ locked, me: null }));
  await page.goto("/admin/test-token?tab=settings&sub=lottery");
  await expect(page.getByText("🔒 群主已锁定")).toBeVisible();
  await expect(page.getByRole("button", { name: "修改时间和奖品" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "取消抽奖" })).toBeDisabled();
  await expect(page.getByText("倒计时结束自动开奖")).toBeVisible();
  await shot(page, "lottery-7-locked", true);
  locked = false;
  await page.getByRole("button", { name: "解锁" }).click();
  await expect(page.getByRole("button", { name: "修改时间和奖品" })).toBeEnabled();
  expect(posts.map((p) => p.url)).toContain("/api/admin/test-token/lottery/1/unlock");
});

test("设置 → 抽奖: published and not locked, someone can still be taken off or put back", async ({ page }) => {
  const posts = await admin(page, () => view({ me: null, entries: entries.slice(1) }), true, [entries[0]]);
  await page.goto("/admin/test-token?tab=settings&sub=lottery");
  await expect(page.getByText("· 1 人不参加")).toBeVisible();
  await page.getByRole("button", { name: "查看名单，选不参加的人" }).click();
  const list = page.getByRole("dialog", { name: "抽奖名单" });
  await expect(list.getByRole("checkbox", { name: "Amy1 参加" })).not.toBeChecked();
  await list.getByRole("checkbox", { name: "Amy1 参加" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/exclude"))?.body).toEqual({ exclude: [] });
});
