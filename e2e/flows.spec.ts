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

  // 卡路里快捷指令: the link and version members install, set here instead of in a deploy.
  const shortcut = page.locator(".card", { has: page.getByRole("heading", { name: "卡路里快捷指令" }) });
  const link = shortcut.getByLabel("iCloud 链接");
  await expect(link).toHaveValue(/^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/);
  const installed = await link.inputValue();
  await link.fill("https://example.com/x");
  await expect(shortcut.getByRole("button", { name: "保存" })).toBeDisabled();
  await link.fill(installed);
  await shortcut.getByRole("button", { name: "保存" }).click();
  await expect(shortcut.getByRole("button", { name: "已保存" })).toBeVisible();
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
  await expect(page.getByRole("switch", { name: /我自己也报名/ })).toBeChecked();
  await field(page, "日期").fill(inAWeek());
  await field(page, "场馆").fill(VENUE);
  await page.getByLabel("备注（选填）").fill("请自带球拍\n提前十分钟到场");
  await page.getByRole("button", { name: "创建活动" }).click();
  // It opens the new event: open for sign-up, with the Owner on the roster.
  const info = page.locator(".card", { hasText: VENUE }).first();
  await expect(info).toContainText("1 人已报名");
  await expect(info).toContainText("报名中");
  await expect(info.locator(".event-notes")).toHaveText("请自带球拍\n提前十分钟到场");
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
  // 排队系统 goes with the venue: picking it sets the switch the way its last event had it (off).
  const queue = page.getByRole("switch", { name: "排队系统" });
  await expect(queue).not.toBeChecked();
  await queue.check();
  await expect(page.getByLabel("每轮多少分钟")).toHaveValue("45");
  await page.screenshot({ path: test.info().outputPath("create-queue.png"), fullPage: true });
  await page.getByRole("button", { name: VENUE, exact: true }).click();
  await expect(queue).not.toBeChecked();
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
  await expect(card.locator(".event-notes")).toHaveText("请自带球拍\n提前十分钟到场");
  expect(await card.locator(".event-notes").evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
  await expect(card.locator(".hero-top")).toContainText("截止");
  await card.getByRole("button", { name: "报名" }).click();
  await expect(card.locator(".friends-row")).toContainText(/带朋友最多 \d+ 个朋友/);
  await card.locator(".stepper button").last().click();
  await field(page, "朋友 1").fill("阿强");
  await card.getByRole("button", { name: "确认报名" }).click();
  // Signed up: the corner reads 我已报名 with a tick, and there's no 已报名 line underneath.
  await expect(card.locator(".hero-top .status-mine")).toHaveText("我已报名");
  await expect(card.locator(".ok")).toHaveCount(0);

  // Signed up, so they see who else is coming, friends included.
  const names = card.locator(".roster-fold");
  await expect(names.locator("summary")).toHaveText("名单（3 人）");
  await expect(names.locator(".names li")).toHaveText(["Jay", "小明（我）", "阿强（小明带）"]);

  // 加入日历 is a calendar icon in the card's top right corner, next to 分享名片's share icon;
  // it opens a short menu of Apple 日历 / Outlook (the .ics) and Google 日历.
  await expect(card.locator(".ev-head .hero-top .share-icon")).toHaveCount(2);
  await expect(card.locator(".calendar")).toHaveCount(0);
  await card.getByRole("button", { name: "加入日历" }).click();
  await expect(card.getByRole("menuitem")).toHaveText(["Apple 日历 / Outlook", "Google 日历"]);
  const google = new URL((await card.getByRole("menuitem", { name: "Google 日历" }).getAttribute("href"))!);
  expect(google.searchParams.get("dates")).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  // Tapping it must reach the server's .ics, not the app's own router (which showed 页面不存在).
  const download = page.waitForEvent("download");
  await card.getByRole("menuitem", { name: "Apple 日历 / Outlook" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^badminton-\d{4}-\d{2}-\d{2}\.ics$/);
  const ics = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain(`LOCATION:${VENUE}`);
  await expect(page.getByRole("heading", { name: "你好，小明" })).toBeVisible(); // still on the member page
  await expect(card.getByRole("menu")).toHaveCount(0); // the menu closes once a calendar is picked
  await expect(card.locator(".ev-head .hero-top .share-icon").last()).toHaveAccessibleName("分享");
  // The same 活动名片 as on the public page, from inside their own event card.
  await card.getByRole("button", { name: "分享", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "分享" }).locator("img.sharecard")).toHaveAttribute(
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
  await expect(page.getByRole("button", { name: /名字/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /退出/ })).toHaveCount(0);
  const hero = page.locator(".me-card");
  await expect(hero).toContainText("微信名 xiaoming");
  await expect(hero).toContainText(/\d{4}年\d{1,2}月\d{1,2}日入群/);
  await expect(hero.locator(".me-nums")).toHaveText("过去一年打球0缺席0即将参加1");
  await page.locator(".heatmap-grid .upcoming").click();
  await expect(page.locator(".heatmap-detail")).toContainText(VENUE);

  const settings = page.locator(".set-list");
  const email = settings.getByRole("button", { name: /邮箱/ });
  await expect(email).toContainText("ming.reg@example.com");
  await email.click();
  await field(page, "邮箱").fill("xm@example.com");
  await settings.getByRole("button", { name: "保存" }).click();
  await expect(email).toContainText("xm@example.com");

  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  await page.getByRole("button", { name: "小明", exact: true }).click();
  const detail = page.locator(".card.profile");
  await expect(detail.locator(".profile-info")).toContainText("xm@example.com");
  await expect(detail.locator(".heatmap-grid .upcoming")).toHaveCount(1);
  await detail.getByRole("button", { name: "添加" }).click();
  await field(page, "备注名（只有群主、管理员和组织者能看到）").fill("周六队长");
  await detail.getByRole("button", { name: "保存" }).click();
  await expect(detail.locator(".profile-info")).toContainText("周六队长");
  await page.getByRole("button", { name: "‹ 成员" }).click();
  await expect(page.locator(".who", { hasText: "小明" })).toContainText("备注：周六队长");

  await page.goto(`${memberPath}/profile`);
  await expect(page.locator(".me-card")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("周六队长");
});

test("public pages show the headcount and a link preview, never names", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".next-event, .event-link", { hasText: VENUE });
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

  // The public event page has the new card: 加入日历 as the calendar icon in its corner, with the same menu; the .ics downloads too.
  await page.goto(`/e/${eventCode}`);
  const download = page.waitForEvent("download");
  await page.locator(".card").getByRole("button", { name: "加入日历" }).click();
  await page.getByRole("menuitem", { name: "Apple 日历 / Outlook" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ics$/);

  // 分享名片 as the share icon next to it: an image with the logo, QR code and link, to long-press.
  await expect(page.locator(".share-site")).toHaveCount(0); // the home page's 分享 is not under the card
  await page.locator(".card").getByRole("button", { name: "分享", exact: true }).click();
  const card = page.getByRole("dialog", { name: "分享" });
  await expect(card.locator("img.sharecard")).toHaveAttribute("src", /^data:image\/png;base64,/);
  // No title and no 下载图片 button: only the image, the long-press hint and ✕.
  await expect(card.locator(".sheet-head strong")).toHaveCount(0);
  await expect(card.getByRole("link")).toHaveCount(0);
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
  await expect(page.locator(".hero-top .status-mine")).toHaveText("我已报名");
  await expect(page.locator(".roster-fold summary")).toHaveText("名单（3 人）");
  await page.goto("/");
  await expect(page.locator(".next-card .status")).toHaveText("我已报名"); // the home card too
  await expect(page.locator(".next-cta")).toHaveText("查看 →"); // already on it: nothing left to sign up for
  // The button and the card itself open the same page: the event's own card.
  await expect(page.locator(".next-cta")).toHaveAttribute("href", `/e/${eventCode}`);
  await expect(page.locator(".next-event")).toHaveAttribute("href", `/e/${eventCode}`);
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
  await expect(pub.getByRole("button", { name: "加入日历" })).toBeVisible();
  await expect(pub.getByRole("button", { name: "分享", exact: true })).toHaveCount(0);
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
  await expect(bill.locator(".status")).toHaveText("我已报名（请付款）");
  await expect(bill.getByRole("button", { name: "分享", exact: true })).toHaveCount(0); // only 报名中 events are shared
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

test("the Owner appoints an organizer, hands them an event and revokes them", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  const block = page.locator(".card", { has: page.getByRole("heading", { name: /^组织者（/ }) });
  await expect(block).toContainText("还没有组织者");
  const ming = page.locator(".row", { hasText: "小明" });
  await ming.getByRole("button", { name: "设为组织者" }).click();
  // Linked to Google here without an email, so nobody could be told: the Owner is asked to.
  await expect(page.getByText(/小明 已成为组织者，但他没有可以收信的邮箱/)).toBeVisible();
  await expect(ming.locator(".badge")).toHaveText("组织者");
  await expect(block).toContainText("收款设置没填好");
  await expect(block).toContainText("负责 0 场未归档活动");

  // The finalized event: only who runs it changes, the money still goes to the Owner.
  await page.locator(".tabs").getByRole("button", { name: "活动" }).click();
  await page.locator(".event-link", { hasText: VENUE }).click();
  const owner = page.locator(".card", { has: page.getByRole("heading", { name: "负责人" }) });
  await expect(owner).toContainText("负责人：Jay · 收款人：Jay");
  await owner.locator("select").selectOption({ label: "小明" });
  await owner.getByRole("button", { name: "转交" }).click();
  await expect(owner).toContainText("负责人：小明 · 收款人：Jay");
  expect(dialogs.pop()).toContain("只换负责人");

  await page.getByRole("button", { name: "‹ 所有活动" }).click();
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  await expect(block).toContainText("负责 1 场未归档活动");
  await block.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("已撤销 小明 的组织者身份")).toBeVisible();
  expect(dialogs.pop()).toContain("负责人转给群主，收款人不变");
  await expect(ming.locator(".badge")).toHaveCount(0);
  await expect(block).toContainText("还没有组织者");
});

test("the Owner appoints an admin, demotes them to organizer and revokes them", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  const members = page.locator(".card", { has: page.getByRole("heading", { name: /^成员（/ }) });
  const ming = members.locator(".row", { hasText: "小明" });
  await ming.getByRole("button", { name: "设为管理员" }).click();
  expect(dialogs.pop()).toContain("像群主一样管理整个群");
  await expect(page.getByText(/小明 已成为管理员/)).toBeVisible();
  await expect(ming.locator(".badge")).toHaveText("管理员");
  const block = page.locator(".card", { has: page.getByRole("heading", { name: /^管理员和组织者（/ }) });
  await expect(block).toContainText("小明");
  await expect(ming.getByRole("button", { name: "设为组织者" })).toHaveCount(0);

  await ming.getByRole("button", { name: "降为组织者" }).click();
  await expect(page.getByText(/小明 已改为组织者/)).toBeVisible();
  await expect(ming.locator(".badge")).toHaveText("组织者");
  await ming.getByRole("button", { name: "升为管理员" }).click();
  await expect(ming.locator(".badge")).toHaveText("管理员");

  await ming.getByRole("button", { name: "撤销管理员" }).click();
  await expect(page.getByText("已撤销 小明 的管理员身份")).toBeVisible();
  await expect(ming.locator(".badge")).toHaveCount(0);
});

test("an organizer signs in with Google and runs their own event", async ({ page, context, baseURL }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  await page.locator(".row", { hasText: "小明" }).getByRole("button", { name: "设为组织者" }).click();
  await expect(page.getByText(/小明 已成为组织者/)).toBeVisible();

  // 小明 signs in with Google; his own page offers 管理页.
  const ming = googleSession("google-ming", "ming@example.com");
  await context.addCookies([{ name: "jb_member", value: ming, url: baseURL! }]);
  await page.goto("/me");
  await page.getByRole("link", { name: "管理页", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/google$/);
  const tabs = page.locator(".tabs");
  await expect(tabs.getByRole("button")).toHaveText(["活动", "收款", "待审核", "成员", "设置"]);

  // 成员 and 待审核 read-only: the same people, no buttons; Owner-only endpoints refuse.
  await tabs.getByRole("button", { name: "成员" }).click();
  await expect(page.locator(".row", { hasText: "Jay" }).first()).toBeVisible();
  for (const name of ["停用", "链接", "重新生成", "生成备用链接", "设为组织者", "撤销组织者", "撤销"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await tabs.getByRole("button", { name: /待审核/ }).click();
  await expect(page.getByText("只有群主和管理员可以通过或拒绝申请。")).toBeVisible();
  expect((await page.request.get("/api/admin/google/sheets")).status()).toBe(403);

  // Only his own events: the Owner's are not listed.
  await tabs.getByRole("button", { name: "活动" }).click();
  await expect(page.getByText("没有进行中的活动")).toBeVisible();
  await expect(page.locator(".event-link", { hasText: VENUE })).toHaveCount(0);
  await page.getByRole("button", { name: "＋ 新建活动" }).click();
  await expect(page.locator(".chip-remove")).toHaveCount(0); // forgetting a venue is the Owner's
  await field(page, "日期").fill(inAWeek());
  await field(page, "场馆").fill("Ming Gym");
  await page.getByRole("button", { name: "创建活动" }).click();
  await expect(page.getByText("✓ 你已报名")).toBeVisible();

  // He changes his list: Jay comes too.
  const add = page.locator(".card", { has: page.getByRole("heading", { name: "添加人员" }) });
  await add.locator("select").selectOption({ label: "Jay" });
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("heading", { name: "名单（2）" })).toBeVisible();
  await expect(page.locator(".badge", { hasText: "代为添加" })).toBeVisible();

  // Finalize waits for his own Venmo.
  await page.getByRole("button", { name: "立即截止报名" }).click();
  const settle = async () => {
    await field(page, "场地总费用（美元）").fill("30");
    await field(page, "用球个数").fill("2");
    await field(page, "球单价（美元）").fill("4");
    await page.getByRole("button", { name: "预览每人金额" }).click();
    await page.getByRole("button", { name: "Finalize" }).click();
  };
  await settle();
  await expect(page.getByText("请先在收款设置里填好 Venmo 和通知邮箱")).toBeVisible();

  await page.getByRole("button", { name: "‹ 所有活动" }).click();
  await tabs.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "修改群主密码" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "不再当组织者" })).toBeVisible();
  // 给组织者的说明: nothing set up yet, so the checklist is open with nothing ticked.
  const guide = page.locator(".card", { has: page.getByRole("heading", { name: "给组织者的说明" }) });
  await expect(guide.locator("details").first()).toHaveAttribute("open", "");
  await expect(guide.locator(".checklist li.done")).toHaveCount(0);
  await field(page, "你的 Venmo 用户名").fill("ming-venmo");
  await field(page, "Venmo 通知邮箱").fill("ming@venmo.test");
  await page.getByRole("button", { name: "保存收款设置" }).click();
  await expect(page.locator(".card", { has: page.getByRole("heading", { name: "我的收款设置" }) })).toContainText(
    "@ming-venmo",
  );
  await expect(guide.locator(".checklist li.done")).toHaveCount(1);

  await tabs.getByRole("button", { name: "活动" }).click();
  await page.locator(".event-link", { hasText: "Ming Gym" }).click();
  await settle();
  await expect(page.getByText("费用（已 Finalize，可修改）")).toBeVisible();

  // Jay's bill for it names the organizer and pays into his Venmo.
  const jay = googleSession("google-jay", "jay@example.com");
  await context.addCookies([{ name: "jb_member", value: jay, url: baseURL! }]);
  await page.goto("/me");
  const card = page.locator(".card", { hasText: "Ming Gym" });
  await expect(card).toContainText("组织：小明");
  await expect(card).toContainText("本次应付 · 付给小明");
  const venmo = new URL((await card.getByRole("link", { name: "用 Venmo 付 $19.00" }).getAttribute("href"))!);
  expect(venmo.searchParams.get("recipients")).toBe("ming-venmo");
});

test("an admin signs in with Google and runs the group, but not the Owner's own things", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  page.on("dialog", (d) => void d.accept());
  // A newcomer applies; what they read no longer says only the Owner reviews it.
  const visitor = await browser.newPage();
  await visitor.goto("/join");
  await field(visitor, "用户名").fill("小红");
  await field(visitor, "微信名").fill("xiaohong");
  await field(visitor, "邮箱").fill("hong@example.com");
  await field(visitor, "再输一次邮箱").fill("hong@example.com");
  await visitor.getByRole("button", { name: "提交申请" }).click();
  await expect(visitor.getByRole("heading", { name: "申请已提交" })).toBeVisible();
  await expect(visitor.locator("main")).toContainText("审核通过后，你的专属链接会发到 hong@example.com");
  await expect(visitor.locator("main")).not.toContainText("群主");
  await visitor.close();

  // The organizer 小明 becomes an admin and signs in with Google.
  await openAdmin(page);
  await page.locator(".tabs").getByRole("button", { name: "成员" }).click();
  const members = page.locator(".card", { has: page.getByRole("heading", { name: /^成员（/ }) });
  await members.locator(".row", { hasText: "小明" }).getByRole("button", { name: "升为管理员" }).click();
  await expect(page.getByText(/小明 已成为管理员/)).toBeVisible();
  const ming = googleSession("google-ming", "ming@example.com");
  await context.addCookies([{ name: "jb_member", value: ming, url: baseURL! }]);
  await page.goto("/admin/google");
  const tabs = page.locator(".tabs");
  await expect(tabs.getByRole("button")).toHaveText(["活动", "收款", "待审核 (1)", "成员", "设置"]);

  // 设置: his own payment, Telegram and stepping down, the group's settings and export; none of the Owner's.
  await tabs.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "给管理员的说明" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的收款设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "导出数据" })).toBeVisible();
  await expect(page.getByRole("button", { name: "不再当管理员" })).toBeVisible();
  for (const heading of ["修改群主密码", "管理链接", "备份网站密钥", "危险操作", "用 Google 登录管理页", "收款设置"])
    await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Google 表格同步/ }).click();
  await expect(page.getByText("开启、关闭同步和查看脚本只有群主能做。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开启同步" })).toHaveCount(0);
  await page.getByRole("button", { name: "‹ 设置" }).click();

  // 待审核: he approves 小红.
  await tabs.getByRole("button", { name: /待审核/ }).click();
  await page.locator(".row", { hasText: "小红" }).getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("小红 的专属链接")).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();

  // 成员: nothing on the Owner's row or his own; he can 停用 小红 but only the Owner deletes her.
  await tabs.getByRole("button", { name: "成员" }).click();
  for (const who of ["Jay", "小明"]) {
    const row = members.locator(".row", { hasText: who });
    await expect(row.locator(".who")).toBeVisible();
    await expect(row.locator(".actions")).toHaveCount(0);
  }
  const hong = members.locator(".row", { hasText: "小红" });
  await expect(hong.getByRole("button", { name: "设为组织者" })).toBeVisible();
  await expect(hong.getByRole("button", { name: "设为管理员" })).toHaveCount(0);
  await hong.getByRole("button", { name: "停用" }).click();
  await expect(hong).toHaveCount(0);
  await page.getByText(/^已停用（/).click();
  const inactive = page.locator(".row", { hasText: "小红" });
  await expect(inactive.getByRole("button", { name: "恢复" })).toBeVisible();
  await expect(inactive.getByRole("button", { name: "删除" })).toHaveCount(0);
  // 群操作记录 names who did what.
  await page.getByText("群操作记录").click();
  await expect(page.locator(".audit")).toContainText("通过 小红 的入群申请");
  await expect(page.locator(".audit")).toContainText("停用 小红");

  // 活动: the Owner's event too, and he can hand it to someone.
  await tabs.getByRole("button", { name: "活动" }).click();
  await page.locator(".event-link", { hasText: VENUE }).click();
  const owner = page.locator(".card", { has: page.getByRole("heading", { name: "负责人" }) });
  await expect(owner).toContainText("负责人：Jay · 收款人：Jay");
  await owner.locator("select").selectOption({ label: "小明" });
  await owner.getByRole("button", { name: "转交" }).click();
  await expect(owner).toContainText("负责人：小明 · 收款人：Jay");
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
