import { expect, test, type Page } from "@playwright/test";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const ev = (id: number, o: object) => ({
  id,
  code: `E${id}`,
  date: "2030-10-13",
  startTime: "20:30",
  endTime: "22:30",
  location: "Synergy",
  address: "",
  title: "",
  status: "closed",
  deadlineAt: "2030-10-12T00:00:00Z",
  headcount: 3,
  myFriends: [],
  selfSignedUp: true,
  canEdit: false,
  friendCap: 2,
  organizer: null,
  runByMe: false,
  managerName: "Jay",
  ownerName: "Jay",
  payment: null,
  roster: null,
  queue: null,
  courts: [],
  kcal: null,
  kcalOpen: true,
  kcalUpdate: false,
  kcalInstall: "https://www.icloud.com/shortcuts/909be1bdeb324b88a0caca0b0031aa11",
  ...o,
});

/** 我的活动 and 个人信息 for Ke, with one event to read and one already read; the Shortcut call is caught. */
export async function calorieMocks(page: Page, opts: { board?: boolean; update?: boolean; empty?: boolean } = {}) {
  let board = opts.board ?? false;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({
      json: {
        events: [ev(2, { date: "2030-10-20" }), ev(1, { kcal: 432, kcalUpdate: opts.update ?? false })],
        history: [
          {
            id: 9,
            code: "E9",
            date: "2030-10-06",
            title: "",
            location: "Synergy",
            amountCents: 1100,
            attended: true,
            friends: 0,
            kcal: 386,
          },
        ],
        friendCap: 2,
      },
    }),
  );
  await page.route("**/api/m/tok/events/2/calories", (route) =>
    route.fulfill({
      json: { start: "2030-10-20 20:20", end: "2030-10-20 22:30", upload: "https://x.test/api/calories/abc" },
    }),
  );
  await page.route("**/api/m/tok/calories", (route) =>
    route.fulfill({
      json: {
        year: 2030,
        yearKcal: 8640,
        yearCount: 21,
        board,
        events: opts.empty
          ? []
          : [
              { id: 1, code: "E1", date: "2030-10-13", title: "", location: "Synergy", kcal: 432 },
              { id: 9, code: "E9", date: "2030-10-06", title: "", location: "Synergy", kcal: 386 },
            ],
        shortcut: {
          url: "https://www.icloud.com/shortcuts/909be1bdeb324b88a0caca0b0031aa11",
          outdated: opts.update ?? false,
        },
      },
    }),
  );
  await page.route("**/api/m/tok/calories/delete", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/m/tok/calories/board", async (route) => {
    board = route.request().postDataJSON().on;
    await route.fulfill({ json: { ok: true } });
  });
}

test.describe("on iPhone", () => {
  test.use({ userAgent: IPHONE });

  test("an older Shortcut gets 「点这里更新」, which opens the install sheet saying to replace it", async ({
    page,
  }) => {
    await calorieMocks(page, { update: true });
    await page.goto("/m/tok");
    const card = page.locator(".ev-card", { hasText: "10/13" });
    await expect(page.locator(".ev-card", { hasText: "10/20" }).getByText("点这里更新")).toHaveCount(0);
    await card.getByRole("button", { name: "快捷指令有新版本，点这里更新" }).click();
    const sheet = page.getByRole("dialog", { name: "读取卡路里" });
    await expect(sheet).toContainText("请重新安装一次");
    await expect(sheet).toContainText("选「替换」");
    await expect(sheet.getByRole("link", { name: "安装快捷指令" })).toBeVisible();
  });

  test("读取 explains the Shortcut once, then runs it with the event's times and upload link", async ({ page }) => {
    await calorieMocks(page);
    await page.goto("/m/tok");
    const toRead = page.locator(".ev-card", { hasText: "10/20" });
    const read = page.locator(".ev-card", { hasText: "10/13" });
    await expect(read.locator(".kcal-row")).toContainText("432 千卡");
    await expect(read.locator(".kcal-row")).toContainText("20:30–22:30 · 来自 Apple 健康");
    await expect(page.locator(".mini-card .mini-kcal")).toHaveText("386");

    await toRead.getByRole("button", { name: "读取" }).click();
    const sheet = page.getByRole("dialog", { name: "读取卡路里" });
    await expect(sheet).toContainText("安装快捷指令「ReadBadmintonCalories」");
    await expect(sheet.getByRole("link", { name: "安装快捷指令" })).toHaveAttribute(
      "href",
      "https://www.icloud.com/shortcuts/909be1bdeb324b88a0caca0b0031aa11",
    );
    await expect(sheet).toContainText("只存总数，只有你看得到。");

    // The page hands over to the Shortcuts app; catch where it goes.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    const handover = new Promise<string>((resolve) =>
      cdp.on("Page.frameRequestedNavigation", (e) => e.url.startsWith("shortcuts:") && resolve(e.url)),
    );
    await sheet.getByRole("button", { name: "已安装，开始读取" }).click();
    const href = await handover;
    await expect(sheet).toBeHidden();
    const url = new URL(href);
    expect(url.protocol).toBe("shortcuts:");
    expect(url.searchParams.get("name")).toBe("ReadBadmintonCalories");
    expect(url.searchParams.get("input")).toBe("text");
    expect(JSON.parse(url.searchParams.get("text")!)).toEqual({
      start: "2030-10-20 20:20",
      end: "2030-10-20 22:30",
      upload: "https://x.test/api/calories/abc",
    });
  });
});

test.describe("on iPhone, 个人信息", () => {
  test.use({ userAgent: IPHONE });

  test("always has 卡路里快捷指令, to install the Shortcut again after deleting it", async ({ page }) => {
    // Nothing read yet and off the board: 我的卡路里 is hidden, the row is still there.
    await calorieMocks(page, { empty: true });
    await page.goto("/m/tok/profile");
    await expect(page.locator(".kcal-card")).toHaveCount(0);
    const row = page.getByRole("button", { name: "卡路里快捷指令" });
    await expect(row).not.toContainText("有新版本");
    await row.click();
    const sheet = page.getByRole("dialog", { name: "读取卡路里" });
    await expect(sheet).toContainText("装一次快捷指令就行");
    await expect(sheet).toContainText("在活动卡片上点「读取」");
    await expect(sheet.getByRole("link", { name: "安装快捷指令" })).toHaveAttribute(
      "href",
      "https://www.icloud.com/shortcuts/909be1bdeb324b88a0caca0b0031aa11",
    );
    await expect(sheet.getByRole("button", { name: "已安装，开始读取" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "返回" }).click();
    await expect(sheet).toBeHidden();
  });

  test("says 有新版本 when theirs is older", async ({ page }) => {
    await calorieMocks(page, { update: true });
    await page.goto("/m/tok/profile");
    const row = page.getByRole("button", { name: /卡路里快捷指令/ });
    await expect(row).toContainText("有新版本");
    await row.click();
    await expect(page.getByRole("dialog", { name: "读取卡路里" })).toContainText("请重新安装一次");
  });
});

test("not on iPhone, a number read shows but there's no 读取", async ({ page }) => {
  await calorieMocks(page);
  await page.goto("/m/tok");
  await expect(page.locator(".ev-card", { hasText: "10/13" }).locator(".kcal-row")).toContainText("432 千卡");
  await expect(page.locator(".ev-card", { hasText: "10/20" }).locator(".kcal-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /读取/ })).toHaveCount(0);
});

test("个人信息 shows this year's calories and the 卡路里榜 switch", async ({ page }) => {
  await calorieMocks(page);
  await page.goto("/m/tok/profile");
  const card = page.locator(".kcal-card");
  await expect(card).toContainText("8,640千卡");
  await expect(card).toContainText("21场");
  await expect(card).toContainText("411千卡");
  const sw = card.getByRole("switch");
  await expect(sw).not.toBeChecked();
  const saved = page.waitForRequest("**/api/m/tok/calories/board");
  await card.locator(".switch-card").click();
  expect((await saved).postDataJSON()).toEqual({ on: true });
  await expect(sw).toBeChecked();
  // The Shortcut only runs on iPhone and iPad.
  await expect(page.getByRole("button", { name: /卡路里快捷指令/ })).toHaveCount(0);
});

test("个人信息 deletes one event's calories or all of them, after asking", async ({ page }) => {
  await calorieMocks(page);
  await page.goto("/m/tok/profile");
  const card = page.locator(".kcal-card");
  await card.getByText("明细（2 场）").click();
  const asked: string[] = [];
  page.on("dialog", (d) => {
    asked.push(d.message());
    d.accept();
  });
  let sent = page.waitForRequest("**/api/m/tok/calories/delete");
  await card.getByRole("button", { name: "删除这场的卡路里记录" }).first().click();
  expect((await sent).postDataJSON()).toEqual({ id: 1 });
  sent = page.waitForRequest("**/api/m/tok/calories/delete");
  await card.getByRole("button", { name: "删除我的全部卡路里记录" }).click();
  expect((await sent).postDataJSON()).toEqual({ all: true });
  expect(asked[0]).toContain("432 千卡");
  expect(asked[1]).toContain("全部 2 场");
});

test.describe("on iPhone, after the bill", () => {
  test.use({ userAgent: IPHONE });

  test("卡路里 sits last on the card, under its own line below the bill (Ke Li)", async ({ page }) => {
    await calorieMocks(page);
    await page.route("**/api/m/tok/events", (route) =>
      route.fulfill({
        json: {
          events: [
            ev(2, {
              date: "2030-10-20",
              status: "finalized",
              payment: {
                amountCents: 2392,
                paidCents: 0,
                refundCents: 0,
                status: "unpaid",
                code: "E2",
                shares: [{ name: "Ke", friendIndex: 0, attended: true, courtCents: 2000, shuttleCents: 392 }],
                payeeName: "Jay",
                venmoUsername: "jay",
                zelleAccount: "",
              },
            }),
          ],
          history: [],
          friendCap: 2,
        },
      }),
    );
    await page.goto("/m/tok");
    const card = page.locator(".ev-card", { hasText: "10/20" });
    await expect(card.locator(".kcal-foot")).toBeVisible();
    // Nothing comes after it in the card body.
    expect(await card.locator(".ev-main > :last-child").getAttribute("class")).toBe("kcal-foot");
  });
});
