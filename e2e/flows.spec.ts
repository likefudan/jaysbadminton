import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * The main path through the site in a phone-sized browser, one step per test and in order:
 * setup → join → approve → create → sign up → 个人信息 → public pages → Google sign-in → close & settle → pay → appearance.
 * Each run starts from an empty database (scripts/e2e-server.sh).
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "local-password";
const VENUE = "Test Gym";
let adminPath = "";
let memberPath = "";
let eventCode = "";

const pathOf = (link: string) => new URL(link).pathname;
const field = (page: Page, label: string) =>
  page.locator("label.field", { has: page.getByText(label, { exact: true }) }).locator("input, select");
const acceptDialogs = (page: Page) => page.on("dialog", (d) => d.accept());

/** Opens the admin page, logging in with the password when this browser has no session yet. */
async function openAdmin(page: Page) {
  await page.goto(adminPath);
  await page.locator('.tabs, input[type="password"]').first().waitFor();
  if (await page.locator('input[type="password"]').count()) {
    await field(page, "群主密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.locator(".tabs")).toBeVisible();
}

/**
 * A signed-in Google session for `sub`, written straight into the test server's database (the
 * local server has no Google client; the OAuth exchange itself is covered by the unit tests).
 */
function googleSession(sub: string, email: string, extraSql = ""): string {
  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 86400e3).toISOString();
  const sql = `${extraSql}INSERT INTO member_sessions (id_hash, google_sub, email, expires_at) VALUES ('${hash}', '${sub}', '${email}', '${expires}')`;
  execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/e2e --command "${sql}"`, { stdio: "ignore" });
  return token;
}

/** Seven days from today in Pacific time, as the date input wants it. */
function inAWeek(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    new Date(Date.now() + 7 * 86400e3),
  );
}

test("the Owner sets up the site and the payment details", async ({ page }) => {
  await page.goto("/admin");
  await field(page, "群主密码").fill(PASSWORD);
  await field(page, "你的用户名").fill("Jay");
  await field(page, "你的微信昵称").fill("Jay");
  await page.getByRole("button", { name: "生成管理链接" }).click();
  await expect(page.getByText("你的管理链接")).toBeVisible();
  await expect(page.getByText("你自己的成员链接")).toHaveCount(0); // the Owner signs up from the admin page
  adminPath = pathOf(await page.locator("code.link").first().innerText());
  expect(adminPath).toMatch(/^\/admin\/[\w-]{20,}$/);

  // Same browser, so the admin session from setup applies.
  const token = adminPath.split("/").pop();
  const res = await page.request.post(`/api/admin/${token}/settings/payment`, {
    data: { password: PASSWORD, venmoUsername: "Jays-Badminton", venmoEmail: "owner@example.com" },
  });
  expect(res.ok()).toBe(true);

  // 设置 offers binding a Google account for the admin page; nothing is bound yet.
  await page.goto(`${adminPath}?tab=settings`);
  const google = page.locator(".card", { has: page.getByText("用 Google 登录管理页") });
  await expect(google).toContainText("绑定一个 Google 账号（只能一个）");
  await expect(google.getByRole("button", { name: "先登录 Google" })).toBeVisible();
});

test("a newcomer registers with email and the Owner approves them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "登录 / 注册" }).click();
  await page.getByRole("link", { name: "用邮箱注册" }).click();
  await field(page, "用户名").fill("小明");
  await field(page, "微信名").fill("xiaoming");
  await page.getByLabel("给群主的留言（选填）").fill("小王介绍的");
  await field(page, "邮箱").fill("ming.reg@example.com");
  await field(page, "再输一次邮箱").fill("ming.reg@exampel.com");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByText("两次输入的邮箱不一致")).toBeVisible();
  await field(page, "再输一次邮箱").fill("Ming.Reg@example.com");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByRole("heading", { name: "申请已提交" })).toBeVisible();
  await expect(page.locator("main")).toContainText("ming.reg@example.com");

  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "待审核" }).click();
  await expect(page.locator(".row", { hasText: "小明" })).toContainText("留言：小王介绍的");
  await expect(page.locator(".row", { hasText: "小明" })).toContainText("邮箱：ming.reg@example.com");
  await page.getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("小明 的专属链接")).toBeVisible();
  await expect(page.getByText("已自动发到 ming.reg@example.com")).toBeVisible();
  await expect(page.getByText(/邮件服务尚未配置/)).toBeVisible(); // the test server has no Resend key
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

  // 我的报名: the Owner manages their own sign-up right here.
  const mySignup = page.locator(".card", { has: page.getByRole("heading", { name: "我的报名" }) });
  await expect(mySignup).toContainText("✓ 你已报名");
  await mySignup.getByRole("button", { name: "修改" }).click();
  await mySignup.locator(".stepper button").last().click();
  await mySignup.getByRole("button", { name: "保存修改" }).click();
  await expect(mySignup).toContainText("✓ 你已报名，带 1 个朋友（Jay的朋友1）");
  await expect(page.getByRole("heading", { name: "名单（2）" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await mySignup.getByRole("button", { name: "取消报名" }).click();
  await expect(mySignup).toContainText("你还没有报名");
  await mySignup.getByRole("button", { name: "报名" }).click();
  await mySignup.getByRole("button", { name: "确认报名" }).click();
  await expect(mySignup).toContainText("✓ 你已报名");
  await expect(page.getByRole("heading", { name: "名单（1）" })).toBeVisible();
});

test("the Owner forgets a venue from 最近的场馆 with its ✕", async ({ page }) => {
  await openAdmin(page);
  await page.getByRole("button", { name: "＋ 新建活动" }).click();
  await expect(page.getByRole("button", { name: VENUE, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `从最近的场馆中删除「${VENUE}」` }).click(); // no confirmation dialog
  await expect(page.getByText("最近的场馆")).toHaveCount(0);
  await page.reload();
  await openAdmin(page);
  await page.getByRole("button", { name: "＋ 新建活动" }).click();
  await expect(field(page, "日期")).toBeVisible();
  await expect(page.getByText("最近的场馆")).toHaveCount(0);
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

  // Signed up, so they see who else is coming, friends included.
  const names = card.locator(".roster-fold");
  await expect(names.locator("summary")).toHaveText("名单（3 人）");
  await expect(names.locator(".names li")).toHaveText(["Jay", "小明（我）", "阿强（小明带）"]);

  // Tapping it must reach the server's .ics, not the app's own router (which showed 页面不存在).
  const download = page.waitForEvent("download");
  await card.getByRole("link", { name: "iPhone / Outlook" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^badminton-\d{4}-\d{2}-\d{2}\.ics$/);
  const ics = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain(`LOCATION:${VENUE}`);
  await expect(page.getByRole("heading", { name: "你好，小明" })).toBeVisible(); // still on the member page
  const google = new URL((await card.getByRole("link", { name: "Google 日历" }).getAttribute("href"))!);
  expect(google.searchParams.get("dates")).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);

  // 加入日历 and 分享名片 share one row, with no row titles.
  await expect(card.locator(".calendar .calendar-link")).toHaveText(["iPhone / Outlook", "Google 日历", "分享名片"]);
  await expect(card.getByText("加入日历", { exact: true })).toHaveCount(0);
  // The same 活动名片 as on the public page, from inside their own event card.
  await card.getByRole("button", { name: "分享名片", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "分享名片" }).locator("img.sharecard")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await page.getByRole("button", { name: "关闭" }).click();
});

test("the member sees their 个人信息 and the Owner adds a 备注名", async ({ page }) => {
  await page.goto(memberPath);
  const nav = page.getByRole("navigation", { name: "我的页面" });
  await expect(nav.getByRole("link", { name: "我的活动" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main")).not.toContainText(/M\d{3}/); // members never see their ID
  await nav.getByRole("link", { name: "个人信息" }).click(); // same tab row on both pages
  await expect(page.getByRole("heading", { name: "个人信息", level: 1 })).toBeVisible();
  await expect(nav.getByRole("link", { name: "个人信息" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main")).not.toContainText(/M\d{3}/);
  await expect(page.getByRole("button", { name: "修改用户名" })).toBeVisible();
  await expect(page.getByRole("button", { name: /退出/ })).toHaveCount(0);
  const profile = page.locator(".card.profile");
  await expect(profile.locator(".profile-info")).toContainText("xiaoming");
  await expect(profile.locator(".profile-info")).toContainText(/入群时间\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/);
  await expect(profile.locator(".heatmap-summary")).toHaveText("过去一年参加 0 次 · 缺席 0 次 · 即将参加 1 次");
  await profile.locator(".heatmap-grid .upcoming").click();
  await expect(profile.locator(".heatmap-detail")).toContainText(VENUE);

  await expect(profile.locator(".profile-info")).toContainText("ming.reg@example.com");
  await profile.getByRole("button", { name: "修改" }).click();
  await field(page, "邮箱").fill("xm@example.com");
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.locator(".profile-info")).toContainText("xm@example.com");

  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  await page.getByRole("button", { name: "小明", exact: true }).click();
  const detail = page.locator(".card.profile");
  await expect(detail.locator(".profile-info")).toContainText("xm@example.com");
  await expect(detail.locator(".heatmap-grid .upcoming")).toHaveCount(1);
  await detail.getByRole("button", { name: "添加" }).click();
  await field(page, "备注名（只有群主能看到）").fill("周六队长");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.locator(".profile-info")).toContainText("周六队长");
  await page.getByRole("button", { name: "‹ 成员" }).click();
  await expect(page.locator(".who", { hasText: "小明" })).toContainText("备注：周六队长");

  await page.goto(`${memberPath}/profile`);
  await expect(page.locator(".card.profile")).not.toContainText("周六队长");
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
  expect(html).toMatch(
    /<meta property="og:description" content="19:00–21:00 · Test Gym · 已报名 3 人 · 报名截止 [^"]+"/,
  );
  expect(html).toContain('/og-image.jpg"');
  expect(html).not.toContain("小明");

  // The public event page has the same 加入日历 button; tapping it downloads the .ics too.
  await page.goto(`/e/${eventCode}`);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "iPhone / Outlook" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ics$/);

  // 分享名片 in the event card's action row, next to the calendar buttons: an image with the logo, QR code and link, to long-press or download.
  await expect(page.getByRole("button", { name: "生成分享名片" })).toHaveCount(0); // the old button under the card is gone
  await page.locator(".card").getByRole("button", { name: "分享名片", exact: true }).click();
  const card = page.getByRole("dialog", { name: "分享名片" });
  await expect(card.locator("img.sharecard")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const png = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载图片" }).click();
  expect((await png).suggestedFilename()).toBe(`event-${eventCode}.png`);
});

test("signed in with Google: the member sees the roster on shared pages; the Owner binds Google for the admin page", async ({
  page,
  context,
  baseURL,
}) => {
  acceptDialogs(page);
  const ming = googleSession(
    "google-ming",
    "ming@example.com",
    "UPDATE members SET google_sub = 'google-ming' WHERE username = '小明'; ",
  );
  await context.addCookies([{ name: "jb_member", value: ming, url: baseURL! }]);
  await page.goto(`/e/${eventCode}`);
  await expect(page.getByText("✓ 已报名，带 1 个朋友")).toBeVisible();
  await expect(page.locator(".roster-fold summary")).toHaveText("名单（3 人）");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "我的活动", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "登录 / 注册" })).toHaveCount(0);

  // The Owner binds their Google account in 设置, then gets in with it alone.
  const jay = googleSession("google-jay", "jay@example.com");
  await context.addCookies([{ name: "jb_member", value: jay, url: baseURL! }]);
  await page.goto("/admin/google");
  await expect(page.getByRole("button", { name: /Google 账号登录|使用 Google 登录/ })).toBeVisible(); // not bound yet
  await openAdmin(page);
  await page.goto(`${adminPath}?tab=settings`);
  const card = page.locator(".card", { has: page.getByText("用 Google 登录管理页") });
  await card.getByRole("button", { name: "绑定 jay@example.com" }).click();
  await expect(card).toContainText("已绑定 jay@example.com");
  await context.clearCookies({ name: "jb_admin" });
  await page.goto("/admin/google");
  await expect(page.locator(".tabs")).toBeVisible();
  await page.goto("/me");
  await expect(page.getByRole("link", { name: "管理页", exact: true })).toHaveAttribute("href", "/admin/google");
});

test("the Owner closes sign-up and settles; the member sees the bill and a Venmo link", async ({ page }) => {
  acceptDialogs(page);
  await openAdmin(page);
  await page.locator(".event-link", { hasText: VENUE }).click();
  await page.getByRole("button", { name: "立即截止报名" }).click();
  await expect(field(page, "场地总费用（美元）")).toBeVisible();

  // Sign-up closed: the public card keeps 加入日历 but no longer offers 分享名片.
  const pub = await page.context().newPage();
  await pub.goto(`/e/${eventCode}`);
  await expect(pub.getByRole("link", { name: "Google 日历" })).toBeVisible();
  await expect(pub.getByRole("button", { name: "分享名片", exact: true })).toHaveCount(0);
  await pub.close();

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
  await expect(bill.getByRole("button", { name: "分享名片", exact: true })).toHaveCount(0); // only 报名中 events are shared
  const code = await bill.locator(".memo code").innerText();
  expect(code).toMatch(/^xiaoming-jbm\d{8}-m002$/);
  const venmo = new URL((await bill.getByRole("link", { name: "用 Venmo 付 $48.00" }).getAttribute("href"))!);
  expect(venmo.hostname).toBe("venmo.com");
  expect(Object.fromEntries(venmo.searchParams)).toMatchObject({
    txn: "pay",
    recipients: "Jays-Badminton",
    amount: "48.00",
    note: code,
  });
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
