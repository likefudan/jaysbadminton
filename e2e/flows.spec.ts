import { expect, test, type Page } from "@playwright/test";

/**
 * The main path through the site in a phone-sized browser, one step per test and in order:
 * setup → join → approve → create → sign up → public pages → close & settle → pay → appearance.
 * Each run starts from an empty database (scripts/e2e-server.sh).
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "local-password";
const VENUE = "Test Gym";
let adminPath = "";
let memberPath = "";
let eventCode = "";

const pathOf = (link: string) => new URL(link).pathname;
const field = (page: Page, label: string) => page.locator("label.field", { has: page.getByText(label, { exact: true }) }).locator("input, select");
const acceptDialogs = (page: Page) => page.on("dialog", (d) => d.accept());

/** Opens the admin page, logging in with the password when this browser has no session yet. */
async function openAdmin(page: Page) {
  await page.goto(adminPath);
  await page.locator('.tabs, input[type="password"]').first().waitFor();
  if (await page.locator('input[type="password"]').count()) {
    await field(page, "管理密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.locator(".tabs")).toBeVisible();
}

/** Seven days from today in Pacific time, as the date input wants it. */
function inAWeek(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(Date.now() + 7 * 86400e3));
}

test("the Owner sets up the site and the payment details", async ({ page }) => {
  await page.goto("/admin");
  await field(page, "管理密码").fill(PASSWORD);
  await field(page, "你的用户名").fill("Jay");
  await field(page, "你的微信昵称").fill("Jay");
  await page.getByRole("button", { name: "生成管理链接" }).click();
  await expect(page.getByText("你的管理链接")).toBeVisible();
  adminPath = pathOf(await page.locator("code.link").first().innerText());
  expect(adminPath).toMatch(/^\/admin\/[\w-]{20,}$/);

  // Same browser, so the admin session from setup applies.
  const token = adminPath.split("/").pop();
  const res = await page.request.post(`/api/admin/${token}/settings/payment`, {
    data: { password: PASSWORD, venmoUsername: "Jays-Badminton", venmoEmail: "owner@example.com" },
  });
  expect(res.ok()).toBe(true);
});

test("a newcomer applies and the Owner approves them", async ({ page }) => {
  await page.goto("/join");
  await field(page, "用户名").fill("小明");
  await field(page, "微信昵称").fill("xiaoming");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByRole("heading", { name: "申请已提交" })).toBeVisible();

  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "待审核" }).click();
  await page.getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("小明 的专属链接")).toBeVisible();
  memberPath = pathOf(await page.locator("code.link").first().innerText());
  expect(memberPath).toMatch(/^\/m\/[\w-]{20,}$/);
});

test("the Owner creates an event and is signed up for it", async ({ page }) => {
  await openAdmin(page);
  await page.getByRole("button", { name: "＋ 新建活动" }).click();
  await expect(page.locator('input[role="switch"]')).toBeChecked(); // 我自己也报名
  await field(page, "日期").fill(inAWeek());
  await field(page, "场馆").fill(VENUE);
  await page.getByRole("button", { name: "创建活动" }).click();
  // It opens the new event: open for sign-up, with the Owner on the roster.
  const info = page.locator(".card", { hasText: VENUE }).first();
  await expect(info).toContainText("1 人已报名");
  await expect(info).toContainText("报名中");
  await expect(page.getByRole("heading", { name: "名单（1）" })).toBeVisible();
});

test("the member signs up with a friend and can add it to a calendar", async ({ page }) => {
  await page.goto(memberPath);
  await expect(page.getByRole("heading", { name: "你好，小明" })).toBeVisible();
  const card = page.locator(".card", { hasText: VENUE });
  await card.getByRole("button", { name: "报名" }).click();
  await card.locator(".stepper button").last().click();
  await field(page, "朋友 1 的名字（选填）").fill("阿强");
  await card.getByRole("button", { name: "确认报名" }).click();
  await expect(card.getByText("✓ 已报名，带 1 个朋友")).toBeVisible();

  const ics = await card.getByRole("link", { name: "iPhone / Outlook" }).getAttribute("href");
  const res = await page.request.get(ics!);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  expect(await res.text()).toContain(`LOCATION:${VENUE}`);
  const google = new URL((await card.getByRole("link", { name: "Google 日历" }).getAttribute("href"))!);
  expect(google.searchParams.get("dates")).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
});

test("public pages show the headcount and a link preview, never names", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".event-link", { hasText: VENUE });
  await expect(row).toContainText("3 人已报名");
  await expect(page.locator("main")).not.toContainText("小明");
  await expect(page.locator("main")).not.toContainText("阿强");
  eventCode = (await row.getAttribute("href"))!.split("/").pop()!;

  // What WeChat sees when the link is pasted: tags in the raw HTML, no script needed.
  const html = await (await page.request.get(`/e/${eventCode}`)).text();
  expect(html).toMatch(/<meta property="og:description" content="19:00–21:00 · Test Gym · 已报名 3 人 · 报名截止 [^"]+"/);
  expect(html).toContain('/og-image.jpg"');
  expect(html).not.toContain("小明");
});

test("the Owner closes sign-up and settles; the member sees the bill and a Venmo link", async ({ page }) => {
  acceptDialogs(page);
  await openAdmin(page);
  await page.locator(".event-link", { hasText: VENUE }).click();
  await page.getByRole("button", { name: "立即截止报名" }).click();
  await field(page, "场地总费用（美元）").fill("60");
  await field(page, "用球个数").fill("4");
  await field(page, "球单价（美元）").fill("3");
  await page.getByRole("button", { name: "预览每人金额" }).click();
  await expect(page.getByText("合计应收 $72.00")).toBeVisible(); // 3 players: $20 court + $4 shuttles each
  await page.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByText("费用（已 Finalize，可修改）")).toBeVisible();

  await page.goto(memberPath);
  const bill = page.locator(".card", { hasText: "本次应付" });
  await expect(bill.locator(".amount")).toHaveText("$48.00"); // 小明 + 阿强
  await expect(bill.locator(".status")).toHaveText("待付款");
  const code = await bill.locator(".memo code").innerText();
  expect(code).toMatch(/^xiaoming-jbm\d{8}-m002$/);
  const venmo = new URL((await bill.getByRole("link", { name: "用 Venmo 付 $48.00" }).getAttribute("href"))!);
  expect(venmo.hostname).toBe("venmo.com");
  expect(Object.fromEntries(venmo.searchParams)).toMatchObject({ txn: "pay", recipients: "Jays-Badminton", amount: "48.00", note: code });
});

test("a visitor's appearance choice survives a reload", async ({ page }) => {
  await page.goto(memberPath);
  await expect(page.locator("html")).toHaveAttribute("data-style", "minimal");
  await page.getByRole("button", { name: "外观" }).click();
  const sheet = page.getByRole("dialog", { name: "外观" });
  await sheet.getByRole("button", { name: "极光" }).click();
  await sheet.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-style", "aurora");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-style", "aurora");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
});
