import { expect, test, type Page } from "@playwright/test";

/** 球场排队 on a member's card: the courts drawn four to a row, the sheets to enter and change them. */
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const ago = (min: number) => at(-min);
const names = (...n: string[]) => n;
const court = (id: number, n: number, position: number, start: number | null, end: number, accounts: string[]) => ({
  id,
  court: n,
  position,
  startsAt: start === null ? null : at(start),
  endsAt: at(end),
  accounts,
  createdBy: "Ke",
  createdAt: ago(3),
  updatedBy: id === 2 ? "Arthur" : "Ke",
  updatedAt: id === 2 ? ago(1) : ago(3),
});

const queue = {
  roundMin: 45,
  photo: true,
  manage: false,
  accounts: [
    "Xiayw",
    "Pengy",
    "Zi",
    "Yuew",
    "Mark",
    "Ben",
    "Coco",
    "Yixing",
    "Wenxi",
    "Am",
    "Chris",
    "Weicheng",
    "Zhichun",
    "Keoung",
    "Lily",
    "Tom",
    "Dafei",
    "arthur",
  ].map((username, i) => ({
    id: i + 1,
    username,
    password: String(1000 + i),
    addedBy: i < 6 ? "Ke" : "Arthur",
    mine: i < 6,
  })),
  courts: [
    court(1, 1, 0, null, 14, names("Xiayw", "Zi", "Pengy", "Yuew")),
    court(2, 7, 0, null, 4, names("Mark", "Ben", "Coco", "Yixing")),
    court(3, 16, 0, null, 25, names("Wenxi", "Am")),
    court(4, 4, 0, null, 44, names("Tony", "Robert")),
    court(5, 5, 0, null, 16, names("Px", "Ly", "Mer", "Jim")),
    court(6, 6, 1, 4, 49, names("Chris", "Weicheng")),
    court(7, 8, 2, 49, 94, names("Zhichun", "Keoung")),
    // Over already: not shown.
    court(8, 9, 0, null, -1, names("Old")),
  ],
};

const event = {
  id: 9,
  code: "1024",
  date: "2030-10-24",
  startTime: "20:00",
  endTime: "22:30",
  location: "Synergy Badminton",
  address: "",
  title: "",
  notes: "",
  queueRoundMin: 45,
  deadlineAt: "2030-10-23T00:00:00Z",
  status: "closed",
  headcount: 12,
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
  queue,
};

async function setUp(page: Page, ev = event) {
  const posts: { url: string; body: unknown }[] = [];
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [ev], history: [], friendCap: 2 } }),
  );
  await page.route("**/api/m/tok/events/9/queue/**", (route) => {
    posts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/m/tok");
  return posts;
}

test("draws our courts, playing then queued, one account per quarter", async ({ page }) => {
  await setUp(page);
  const cq = page.locator(".cq");
  await expect(cq.locator(".cq-sub").first()).toHaveText("在打 · 5 片");
  await expect(cq.locator(".cq-sub").nth(1)).toHaveText("排队 · 2 组");
  const tiles = cq.locator(".cq-court");
  await expect(tiles).toHaveCount(7);
  // Playing by court number; 7 is nearly up and shows yellow.
  await expect(tiles.locator(".cq-court-head b")).toHaveText(["1号", "4号", "5号", "7号", "16号", "6号", "8号"]);
  await expect(tiles.nth(3)).toHaveClass(/soon/);
  // Four quarters: the first two accounts face each other down the left, then top right, bottom right.
  await expect(tiles.nth(3).locator(".cq-q")).toHaveText(["Mark", "Coco", "Ben", "Yixing"]);
  await expect(tiles.nth(3).locator(".cq-q.ours")).toHaveCount(4);
  // Two accounts hold half the court, across the net; the other two quarters are striped.
  await expect(tiles.nth(4).locator(".cq-q")).toHaveText(["Wenxi", "", "Am", ""]);
  await expect(tiles.nth(4).locator(".cq-q:not(.ours)")).toHaveCount(2);
  await expect(tiles.nth(6).locator(".cq-court-head small")).toHaveText("第2组 ≈49分");
  await expect(cq.locator(".cq-head")).toContainText("Arthur 更新于");
  await page.screenshot({ path: test.info().outputPath("court-queue-card.png") });

  // The buttons stay under the top bar, and the key at the bottom, while the courts scroll by.
  // Room below, so the page can scroll that far whatever fonts the machine has.
  await page.addStyleTag({ content: "body { padding-bottom: 1500px }" });
  await page.evaluate(() =>
    window.scrollTo(0, document.querySelector(".cq-grid")!.getBoundingClientRect().top + scrollY - 40),
  );
  // The top bar's height is measured after load (fonts can change it), so wait for the bar to settle.
  await expect
    .poll(async () => {
      const bar = await cq.locator(".cq-bar").boundingBox();
      const top = await page.locator(".topbar").boundingBox();
      return Math.abs(bar!.y - (top!.y + top!.height));
    })
    .toBeLessThan(2);
  const key = await cq.locator(".cq-legend").boundingBox();
  expect(key!.y + key!.height).toBeLessThanOrEqual(844 + 1);
  await page.screenshot({ path: test.info().outputPath("court-queue-scrolled.png") });

  // Dark mode: the queued courts' net line still shows (it used to vanish into the block).
  await page.emulateMedia({ colorScheme: "dark" });
  const net = tiles.nth(6).locator(".cq-net");
  const colors = await net.evaluate((el) => [
    getComputedStyle(el).borderTopColor,
    getComputedStyle(el.parentElement!).backgroundColor,
  ]);
  expect(colors[0]).not.toEqual(colors[1]);
  await cq
    .locator(".cq-grid")
    .nth(1)
    .screenshot({ path: test.info().outputPath("court-queue-dark.png") });
});

test("a court opens to change its time, accounts or status, or to remove it", async ({ page }) => {
  const posts = await setUp(page);
  await page.locator(".cq-court", { hasText: "8号" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("8 号场");
  await expect(sheet).toContainText("Ke");
  await expect(sheet.getByRole("button", { name: "排第 2 组" })).toHaveClass(/on/);
  const wait = sheet.getByRole("spinbutton", { name: "还要等几分钟" });
  await expect(wait).toHaveValue(/^4[89]$/);
  await page.screenshot({ path: test.info().outputPath("court-queue-edit.png") });

  // Typed, or dragged on the slider beside the box.
  await wait.fill("30");
  const slider = sheet.getByRole("slider", { name: "还要等几分钟" });
  await expect(slider).toHaveAttribute("max", "90");
  await slider.fill("25");
  await expect(wait).toHaveValue("25");
  await sheet.getByRole("button", { name: "Mark" }).click();
  await sheet.getByRole("button", { name: "Keoung" }).click();
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  expect(posts.at(-1)).toEqual({
    url: "/api/m/tok/events/9/queue/courts",
    body: { id: 7, court: 8, position: 2, minutes: 25, accounts: ["Zhichun", "Mark"] },
  });

  page.once("dialog", (d) => d.accept());
  await page.locator(".cq-court", { hasText: "7号" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除（提前结束，不打了）" }).click();
  await expect.poll(() => posts.at(-1)?.url).toBe("/api/m/tok/events/9/queue/courts/2/remove");
});

/** The court tile with exactly this number ("1号" would also find 16号). */
const tile = (page: Page, n: number) =>
  page.locator(".cq-court").filter({ has: page.locator(".cq-court-head b", { hasText: new RegExp(`^${n}号$`) }) });

test("选择 lets the Owner and admins tick courts, playing or queued, and delete them together", async ({ page }) => {
  // Players and organizers don't get it.
  await setUp(page);
  await expect(page.locator(".cq-legend")).toContainText("5 分钟内");
  await expect(page.locator(".cq-legend").getByRole("button", { name: "选择" })).toHaveCount(0);

  const posts = await setUp(page, { ...event, queue: { ...queue, manage: true } });
  await expect(page.locator(".cq-legend")).not.toContainText("不是我们");
  await page.locator(".cq-legend").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("legend-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("legend-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".cq-legend").getByRole("button", { name: "选择" }).click();
  const bar = page.locator(".cq-pickbar");
  await expect(bar).toContainText("已选 0 个");
  await expect(bar.getByRole("button", { name: "批量删除" })).toBeDisabled();
  // Tapping ticks instead of opening the sheet: one playing, one queued.
  await tile(page, 7).click();
  await tile(page, 8).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cq-court.picked")).toHaveCount(2);
  await expect(bar).toContainText("已选 2 个");
  await page.screenshot({ path: test.info().outputPath("court-queue-pick.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("court-queue-pick-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await tile(page, 8).click();
  await expect(bar).toContainText("已选 1 个");

  await bar.getByRole("button", { name: "全选" }).click();
  await expect(bar).toContainText("已选 7 个");
  await bar.getByRole("button", { name: "全不选" }).click();
  await expect(bar).toContainText("已选 0 个");
  await tile(page, 1).click();
  await tile(page, 6).click();
  page.once("dialog", (d) => d.accept());
  await bar.getByRole("button", { name: "批量删除" }).click();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({ url: "/api/m/tok/events/9/queue/courts/remove", body: { ids: [1, 6] } });
  // Done: back to the colour key.
  await expect(page.locator(".cq-pickbar")).toHaveCount(0);
  await expect(page.locator(".cq-legend")).toContainText("5 分钟内");

  // 取消 leaves without deleting.
  await page.locator(".cq-legend").getByRole("button", { name: "选择" }).click();
  await tile(page, 4).click();
  await page.locator(".cq-pickbar").getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".cq-court.picked")).toHaveCount(0);
  await tile(page, 4).click();
  await expect(page.getByRole("dialog")).toContainText("4 号场");
  expect(posts).toHaveLength(1);
});

test("a new queued court works out the wait from the screen", async ({ page }) => {
  const posts = await setUp(page);
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  const sheet = page.getByRole("dialog");
  // 场号 drops down a list, narrowed by what is typed; courts we hold are marked.
  await sheet.getByRole("button", { name: "选择场号" }).click();
  const list = sheet.getByRole("listbox");
  await expect(list.getByRole("option", { name: "16", exact: true })).toHaveClass(/held/);
  await sheet.getByRole("spinbutton", { name: "场号" }).fill("5");
  await expect(list.getByRole("option")).toHaveText(["5", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59"]);
  await page.screenshot({ path: test.info().outputPath("court-queue-number.png") });
  await list.getByRole("option", { name: "52" }).click();
  await expect(list).toBeHidden();
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("52");
  await sheet.getByRole("button", { name: "排第 3 组" }).click();
  await sheet.getByRole("spinbutton", { name: "正在打的还剩几分钟" }).fill("10");
  await expect(sheet).toContainText("大约 100 分钟后上场");
  // 场号 and the status share a row; the minutes box has its slider beside it.
  const box = async (l: ReturnType<typeof sheet.getByRole>) => (await l.boundingBox())!;
  const no = await box(sheet.getByRole("spinbutton", { name: "场号" }));
  const status = await box(sheet.getByRole("button", { name: "排第 3 组" }));
  expect(status.x).toBeGreaterThan(no.x + no.width);
  expect(Math.abs(no.y + no.height / 2 - (status.y + status.height / 2))).toBeLessThan(6);
  const min = await box(sheet.getByRole("spinbutton", { name: "正在打的还剩几分钟" }));
  const drag = await box(sheet.getByRole("slider", { name: "正在打的还剩几分钟" }));
  expect(drag.x).toBeGreaterThan(min.x + min.width);
  expect(Math.abs(min.y + min.height / 2 - (drag.y + drag.height / 2))).toBeLessThan(6);
  // Accounts in alphabetical order, whatever the case; those on a court say where; a search narrows them.
  const chips = sheet.locator(".cq-chips .chip");
  await expect(chips.nth(0)).toHaveText("Am16号");
  await expect(chips.nth(1)).toHaveText("arthur");
  await expect(chips.nth(2)).toHaveText("Ben7号");
  await expect(sheet.getByRole("button", { name: "Mark7号" })).toHaveClass(/cq-busy/);
  await sheet.getByLabel("搜索账号").fill("chr");
  await expect(chips).toHaveText(["Chris6号"]);
  await sheet.getByRole("button", { name: "Chris" }).click();
  // Picked ones move up into their own highlighted row.
  // …with each password in small type under the name.
  await expect(sheet.locator(".cq-picked .chip .cq-pick-name")).toHaveText(["✓ Chris ✕"]);
  await expect(sheet.locator(".cq-picked .chip small")).toHaveText(["1010"]);
  await expect(chips).toHaveCount(0);
  await sheet.getByLabel("搜索账号").fill("");
  await expect(chips.first()).toHaveText("Am16号");
  await page.screenshot({ path: test.info().outputPath("court-queue-new.png") });
  await sheet.getByRole("button", { name: "保存" }).click();
  expect(posts.at(-1)?.body).toEqual({ court: 52, position: 3, minutes: 100, accounts: ["Chris"] });
});

test("a queued group with no minutes typed waits for the group playing on that court", async ({ page }) => {
  const posts = await setUp(page);
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  const sheet = page.getByRole("dialog");
  // 4号 is on the card, playing with about 44 minutes left.
  await sheet.getByRole("spinbutton", { name: "场号" }).fill("4");
  await sheet.getByRole("button", { name: "排第 1 组" }).click();
  const box = sheet.getByRole("spinbutton", { name: "正在打的还剩几分钟" });
  await expect(box).toHaveValue("");
  const left = Number(await box.getAttribute("placeholder"));
  expect(left).toBeGreaterThanOrEqual(43);
  expect(left).toBeLessThanOrEqual(44);
  await expect(sheet).toContainText(`大约 ${left} 分钟后上场`);
  await sheet.getByRole("button", { name: "Chris" }).click();
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => posts.at(-1)?.body).toEqual({ court: 4, position: 1, minutes: left, accounts: ["Chris"] });

  // A court not on the card: the time on the screen has to be typed.
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  await sheet.getByRole("spinbutton", { name: "场号" }).fill("30");
  await sheet.getByRole("button", { name: "排第 1 组" }).click();
  await sheet.getByRole("button", { name: "Chris" }).click();
  const before = posts.length;
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toContainText("请填写正在打的还剩几分钟");
  expect(posts).toHaveLength(before);
});

test("hall accounts: everyone's are listed, yours can be removed, and more added", async ({ page }) => {
  const posts = await setUp(page);
  await page.getByRole("button", { name: "球馆账号（18）" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator(".cq-account").first()).toHaveText("Am · 100916号"); // alphabetical, whatever the case
  await expect(sheet.locator("li", { hasText: "Xiayw" })).toContainText("Ke 提供");
  await expect(sheet.locator("li", { hasText: "Chris" }).getByRole("button", { name: "删除" })).toHaveCount(0);
  // Hall usernames and passwords are often lowercase: phones mustn't capitalise them.
  await expect(sheet.getByLabel("用户名")).toHaveAttribute("autocapitalize", "none");
  await expect(sheet.getByLabel("密码")).toHaveAttribute("autocapitalize", "none");
  await sheet.getByLabel("用户名").fill("Lily");
  await sheet.getByLabel("密码").fill("4321");
  await page.screenshot({ path: test.info().outputPath("court-queue-accounts.png") });
  await sheet.getByRole("button", { name: "添加", exact: true }).click();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({
      url: "/api/m/tok/events/9/queue/accounts",
      body: { username: "Lily", password: "4321" },
    });
});

test("清空全部账号 is for the Owner and admins, after a confirm", async ({ page }) => {
  await setUp(page);
  await page.getByRole("button", { name: "球馆账号（18）" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "清空全部账号" })).toHaveCount(0);

  const posts = await setUp(page, { ...event, queue: { ...queue, manage: true } });
  await page.getByRole("button", { name: "球馆账号（18）" }).click();
  const sheet = page.getByRole("dialog");
  const clear = sheet.getByRole("button", { name: "清空全部账号" });
  await clear.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("court-queue-clear.png") });
  page.once("dialog", (d) => d.dismiss());
  await clear.click();
  expect(posts).toHaveLength(0);
  page.once("dialog", (d) => {
    expect(d.message()).toBe("清空这场的全部 18 个球馆账号？已登记的球场不受影响。");
    return d.accept();
  });
  await clear.click();
  await expect.poll(() => posts.at(-1)).toEqual({ url: "/api/m/tok/events/9/queue/accounts/clear", body: {} });
});

test("批量添加 reads a pasted list as typed, skips accounts already there, and says what it couldn't read", async ({
  page,
}) => {
  const posts = await setUp(page);
  await page.getByRole("button", { name: "球馆账号（18）" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "批量添加" }).click();
  const box = sheet.getByLabel("粘贴账号列表，每行「编号. 用户名 密码」");
  await expect(box).toHaveAttribute("autocapitalize", "none");
  await box.fill(
    [
      "#Group Note",
      "Sunday group password",
      "1. rosa river4",
      "2. MARK owl2",
      "3. 小明 tiger5",
      "4. pandaQ",
      "5. Nina Moon8",
    ].join("\n"),
  );
  await expect(sheet.locator(".cq-batch-preview")).toContainText("会添加 3 个 rosa、小明、Nina");
  await expect(sheet.locator(".cq-batch-preview")).toContainText("已经有了，跳过 1 个：MARK");
  await expect(sheet.locator(".cq-batch-preview .cq-unsure-note")).toContainText("4. pandaQ");
  await sheet.locator(".cq-batch").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("court-queue-batch.png") });
  await page.route("**/api/m/tok/events/9/queue/accounts/batch", (route) => {
    posts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: { added: 3, skipped: [] } });
  });
  await sheet.getByRole("button", { name: "添加 3 个账号" }).click();
  await expect(sheet.getByText("已添加 3 个账号")).toBeVisible();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({
      url: "/api/m/tok/events/9/queue/accounts/batch",
      body: {
        accounts: [
          { username: "rosa", password: "river4" },
          { username: "小明", password: "tiger5" },
          { username: "Nina", password: "Moon8" },
        ],
      },
    });
});

test("拍照登记 fills the form from the photo, one court at a time, with unsure parts in yellow", async ({ page }) => {
  const posts = await setUp(page);
  let sent: { image: string } | null = null;
  await page.route("**/api/m/tok/events/9/queue/photo", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      json: {
        courts: [
          {
            court: 16,
            position: 0,
            minutesLeft: 25,
            accounts: [
              { username: "Wenxi", uncertain: false },
              { username: "Am", uncertain: true },
            ],
          },
          {
            court: 12,
            position: 1,
            minutesLeft: null,
            accounts: [
              { username: "Chris", uncertain: false },
              { username: "Weicheng", uncertain: false },
            ],
          },
        ],
        unreadable: [17],
      },
    });
  });
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByPlaceholder("场号")).toBeVisible();
  await expect(sheet).not.toContainText("拍排队屏幕");
  await expect(sheet.locator(".cq-minutes-box")).toContainText("剩余");
  await page.screenshot({ path: test.info().outputPath("court-sheet-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("court-sheet-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await sheet.locator(".cq-photo input[type=file]").setInputFiles("e2e/fixtures/queue-screen.jpg");

  // The photo goes up shrunk to a JPEG of at most 1600 px.
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("16");
  const size = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    return [img.width, img.height];
  }, sent!.image);
  expect(Math.max(...size)).toBeLessThanOrEqual(1600);

  await expect(sheet).toContainText("找到 2 片场，请注意逐个核对后保存");
  await expect(sheet).toContainText("17号场在照片上看不清");
  await expect(sheet.getByRole("button", { name: "在打", exact: true })).toHaveClass(/on/);
  await expect(sheet.getByRole("spinbutton", { name: "还剩几分钟", exact: true })).toHaveValue("25");
  // The unsure account is yellow, with a note to check it.
  await expect(sheet.locator(".cq-picked .chip .cq-pick-name")).toHaveText(["✓ Wenxi ✕", "✓ Am ✕"]);
  await expect(sheet.locator(".cq-picked .chip").nth(1)).toHaveClass(/cq-unsure/);
  await expect(sheet.locator(".cq-picked .chip").first()).not.toHaveClass(/cq-unsure/);
  await expect(sheet).toContainText("黄色的账号照片上看不太清");
  await page.screenshot({ path: test.info().outputPath("court-queue-photo.png") });

  // 16 is already on the card as playing: saved as a change to it. The sheet moves on to 12.
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("12");
  expect(posts.at(-1)).toEqual({
    url: "/api/m/tok/events/9/queue/courts",
    body: { id: 3, court: 16, position: 0, minutes: 25, accounts: ["Wenxi", "Am"] },
  });
  await expect(sheet.locator(".cq-found-list .chip").first()).toHaveText("✓ 16号 · 在打");
  // The time wasn't read: the box is yellow until it is filled in.
  await expect(sheet.locator(".cq-minutes")).toHaveClass(/cq-unsure/);
  await expect(sheet).toContainText("照片上没读出剩余时间");
  await expect(sheet.locator(".cq-picked .chip.cq-unsure")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("court-queue-photo-next.png") });
  await sheet.getByRole("spinbutton", { name: "正在打的还剩几分钟" }).fill("10");
  await expect(sheet.locator(".cq-minutes")).not.toHaveClass(/cq-unsure/);
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  expect(posts.at(-1)).toEqual({
    url: "/api/m/tok/events/9/queue/courts",
    body: { court: 12, position: 1, minutes: 10, accounts: ["Chris", "Weicheng"] },
  });
});

test("拍照登记: ✕ skips a court read wrongly, it isn't saved, and a tap brings it back", async ({ page }) => {
  const posts = await setUp(page);
  const group = (n: number, position: number, minutesLeft: number, accounts: string[]) => ({
    court: n,
    position,
    minutesLeft,
    accounts: accounts.map((username) => ({ username, uncertain: false })),
  });
  await page.route("**/api/m/tok/events/9/queue/photo", (route) =>
    route.fulfill({
      json: {
        courts: [
          group(16, 0, 25, ["Wenxi", "Am"]),
          group(5, 0, 16, ["Mark", "Ben"]),
          group(12, 1, 30, ["Chris", "Weicheng"]),
        ],
        unreadable: [],
      },
    }),
  );
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  const sheet = page.getByRole("dialog");
  const courtNo = sheet.getByRole("spinbutton", { name: "场号" });
  const chips = sheet.locator(".cq-found-list .chip");
  await sheet.locator(".cq-photo input[type=file]").setInputFiles("e2e/fixtures/queue-screen.jpg");
  await expect(courtNo).toHaveValue("16");
  await expect(sheet.locator(".cq-found-list .chip-remove")).toHaveCount(3);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: test.info().outputPath(`skip-group-before-${scheme}.png`) });
  }

  // Skipping one that isn't shown: struck through, no ✕, the form stays on 16.
  await sheet.getByRole("button", { name: "跳过 5号" }).click();
  await expect(chips.nth(1)).toHaveClass(/cq-skipped/);
  await expect(chips.nth(1)).toHaveText("5号 · 在打");
  await expect(sheet.getByRole("button", { name: "跳过 5号" })).toHaveCount(0);
  await expect(courtNo).toHaveValue("16");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: test.info().outputPath(`skip-group-after-${scheme}.png`) });
  }

  // A tap brings it back and shows it; skipping the one shown moves on to the next left.
  await chips.nth(1).click();
  await expect(chips.nth(1)).not.toHaveClass(/cq-skipped/);
  await expect(courtNo).toHaveValue("5");
  await sheet.getByRole("button", { name: "跳过 5号" }).click();
  await expect(courtNo).toHaveValue("16");

  // Saving 16 goes to 12, past the skipped 5; saving 12 closes the sheet. 5 is never sent.
  const before = posts.length;
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(courtNo).toHaveValue("12");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  const sent = posts.slice(before).map((p) => (p.body as { court: number }).court);
  expect(sent).toEqual([16, 12]);
});

test("拍照登记: skipping every court left closes the sheet", async ({ page }) => {
  const posts = await setUp(page);
  const one = (n: number) => ({
    court: n,
    position: 0,
    minutesLeft: 20,
    accounts: [{ username: "Mark", uncertain: false }],
  });
  await page.route("**/api/m/tok/events/9/queue/photo", (route) =>
    route.fulfill({ json: { courts: [one(5), one(6)], unreadable: [] } }),
  );
  await page.getByRole("button", { name: "＋ 登记球场" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator(".cq-photo input[type=file]").setInputFiles("e2e/fixtures/queue-screen.jpg");
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("5");
  const before = posts.length;
  await sheet.getByRole("button", { name: "跳过 5号" }).click();
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("6");
  await sheet.getByRole("button", { name: "跳过 6号" }).click();
  await expect(sheet).toBeHidden();
  expect(posts.length).toBe(before);
});
