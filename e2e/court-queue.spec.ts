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
});

test("a court opens to change its time, accounts or status, or to remove it", async ({ page }) => {
  const posts = await setUp(page);
  await page.locator(".cq-court", { hasText: "8号" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("8 号场");
  await expect(sheet).toContainText("Ke");
  await expect(sheet.getByRole("button", { name: "排第 2 组" })).toHaveClass(/on/);
  await expect(sheet.getByLabel("还要等几分钟上场")).toHaveValue(/^4[89]$/);
  await page.screenshot({ path: test.info().outputPath("court-queue-edit.png") });

  await sheet.getByLabel("还要等几分钟上场").fill("30");
  await sheet.getByRole("button", { name: "−5" }).click();
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
  await sheet.getByLabel("这片场正在打的那组还剩几分钟").fill("10");
  await expect(sheet).toContainText("大约 100 分钟后上场");
  // Free accounts come before those already on a court, which say where; a search narrows them.
  const chips = sheet.locator(".cq-chips .chip");
  await expect(chips.first()).toHaveText("Lily");
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
  await expect(chips.first()).toHaveText("Lily");
  await page.screenshot({ path: test.info().outputPath("court-queue-new.png") });
  await sheet.getByRole("button", { name: "保存" }).click();
  expect(posts.at(-1)?.body).toEqual({ court: 52, position: 3, minutes: 100, accounts: ["Chris"] });
});

test("hall accounts: everyone's are listed, yours can be removed, and more added", async ({ page }) => {
  const posts = await setUp(page);
  await page.getByRole("button", { name: "球馆账号（17）" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator(".cq-account").first()).toHaveText("Xiayw · 10001号");
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
