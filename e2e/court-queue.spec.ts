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

async function setUp(page: Page) {
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
    route.fulfill({ json: { events: [event], history: [], friendCap: 2 } }),
  );
  await page.route("**/api/m/tok/events/9/queue/**", (route) => {
    posts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/m/tok");
  return posts;
}

test("draws our courts, playing then queued, with the names on the two halves", async ({ page }) => {
  await setUp(page);
  const cq = page.locator(".cq");
  await expect(cq.locator(".cq-sub").first()).toHaveText("在打 · 5 片");
  await expect(cq.locator(".cq-sub").nth(1)).toHaveText("排队 · 2 组");
  const tiles = cq.locator(".cq-court");
  await expect(tiles).toHaveCount(7);
  // Playing by court number; 7 is nearly up and shows yellow.
  await expect(tiles.locator(".cq-court-head b")).toHaveText(["1号", "4号", "5号", "7号", "16号", "6号", "8号"]);
  await expect(tiles.nth(3)).toHaveClass(/soon/);
  await expect(tiles.nth(3).locator(".cq-half").first()).toHaveText("MarkCoco");
  await expect(tiles.nth(3).locator(".cq-half").nth(1)).toHaveText("BenYixing");
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

  // Typed, or dragged on the slider that shows once the box is tapped.
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
  // 场号 and the minutes share a row.
  const no = await sheet.getByRole("spinbutton", { name: "场号" }).boundingBox();
  const min = await sheet.getByRole("spinbutton", { name: "正在打的还剩几分钟" }).boundingBox();
  expect(Math.abs(no!.y - min!.y)).toBeLessThan(2);
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
  await sheet.getByRole("button", { name: "添加" }).click();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({
      url: "/api/m/tok/events/9/queue/accounts",
      body: { username: "Lily", password: "4321" },
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
  await sheet.locator(".cq-photo input[type=file]").setInputFiles("e2e/fixtures/queue-screen.jpg");

  // The photo goes up shrunk to a JPEG of at most 1600 px.
  await expect(sheet.getByRole("spinbutton", { name: "场号" })).toHaveValue("16");
  const size = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    return [img.width, img.height];
  }, sent!.image);
  expect(Math.max(...size)).toBeLessThanOrEqual(1600);

  await expect(sheet).toContainText("找到 2 片场，逐个核对后保存");
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
