import { expect, type Page, test } from "@playwright/test";

const SHOTS = process.env.UI_REVIEW_SCREENSHOTS;

const player = (id: string | null, name: string, answer: "ok" | "no" | null = null, me = false) => ({
  id,
  name,
  answer,
  me,
});

const event = (scores: object) => ({
  id: 1,
  code: "26-1120",
  date: "2030-11-20",
  startTime: "19:00",
  endTime: "22:00",
  location: "Synergy",
  address: "",
  title: "",
  status: "closed",
  deadlineAt: "2030-11-19T00:00:00Z",
  headcount: 8,
  myFriends: [],
  myGuests: [],
  broughtBy: null,
  selfSignedUp: true,
  myStay: { arrive: null, leave: null },
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
  kcalOpen: false,
  kcalUpdate: false,
  kcalInstall: "",
  likes: null,
  scores,
});

async function setUp(page: Page, scores: () => object, onPost: (path: string, body: any) => void) {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [event(scores())], history: [], friendCap: 2 } }),
  );
  await page.route("**/api/m/tok/events/1/scores/people", (route) =>
    route.fulfill({
      json: {
        people: ["Amy", "Bob", "Cat", "Dan"].map((name, i) => ({ id: `M00${i + 1}`, name, avatar: null })),
      },
    }),
  );
  await page.route(/\/api\/m\/tok\/events\/1\/scores(\/\d+\/\w+)?$/, (route) => {
    onPost(new URL(route.request().url()).pathname, route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, id: 9 } });
  });
}

/** 比分 (Ke Li 2026-11-21): record a doubles match with a 路人, and confirm one someone else recorded. */
test("records a doubles match with a guest and confirms one recorded by someone else", async ({ page }) => {
  const posts: [string, any][] = [];
  let answered = false;
  const toConfirm = {
    id: 3,
    doubles: true,
    games: [[21, 17]],
    sides: [
      [player("M002", "Bob", "ok"), player("M001", "Amy")],
      [player("M007", "Ke", null, true), player("M003", "Cat")],
    ],
    status: "pending",
    recorder: "Bob",
    mine: false,
    toAnswer: !answered,
    createdAt: "2030-11-20T04:00:00Z",
  };
  const scores = () => ({
    open: true,
    matches: [
      {
        id: 1,
        doubles: true,
        games: [
          [21, 18],
          [19, 21],
          [21, 15],
        ],
        sides: [
          [player("M007", "Ke", "ok", true), player("M001", "Amy", "ok")],
          [player("M004", "Dan", "ok"), player(null, "阿杰")],
        ],
        status: "confirmed",
        recorder: "Ke",
        mine: true,
        toAnswer: false,
        createdAt: "2030-11-20T03:35:00Z",
      },
      {
        id: 2,
        doubles: false,
        games: [[15, 21]],
        sides: [[player("M007", "Ke", "ok", true)], [player("M003", "Cat")]],
        status: "pending",
        recorder: "Ke",
        mine: true,
        toAnswer: false,
        createdAt: "2030-11-20T04:10:00Z",
      },
      {
        ...toConfirm,
        toAnswer: !answered,
        sides: answered
          ? [toConfirm.sides[0], [{ ...toConfirm.sides[1][0], answer: "ok" }, toConfirm.sides[1][1]]]
          : toConfirm.sides,
      },
    ],
  });
  await setUp(page, scores, (path, body) => {
    posts.push([path, body]);
    if (path.endsWith("/3/answer")) answered = true;
  });

  await page.goto("/m/tok");
  const foot = page.locator(".score-foot");
  await expect(foot).toContainText("Bob 记录了这场，等你确认");
  // The viewer's side on the left, even when they played on the other side.
  const ask = foot.locator(".score-match").first();
  await expect(ask.locator(".score-side").first()).toContainText("你");
  await expect(ask.locator(".score-game.first")).toHaveText("17 : 21");
  await expect(foot).toContainText("路人·阿杰");
  await expect(foot).toContainText("等 Cat 确认");
  await expect(foot).toContainText("✓ 已确认");
  if (SHOTS) await foot.scrollIntoViewIfNeeded().then(() => page.screenshot({ path: `${SHOTS}/1-card.png` }));

  await ask.getByRole("button", { name: "确认" }).click();
  await expect.poll(() => posts.map((p) => p[0])).toContain("/api/m/tok/events/1/scores/3/answer");
  expect(posts.at(-1)![1]).toEqual({ ok: true });
  await expect(foot).not.toContainText("等你确认");

  await foot.getByRole("button", { name: "记录比分" }).click();
  const panel = page.getByRole("dialog", { name: "记录比分" });
  // Doubles first: partner, then both opponents.
  await panel.getByRole("button", { name: "Amy" }).click();
  await panel.getByRole("button", { name: "Dan" }).click();
  await panel.getByRole("button", { name: "＋ 路人" }).click();
  await panel.getByLabel("路人的名字").fill("阿杰");
  await panel.getByLabel("第 1 局我方").fill("21");
  await panel.getByLabel("第 1 局对方").fill("18");
  await panel.getByRole("button", { name: "＋ 再加一局" }).click();
  await panel.getByLabel("第 2 局我方").fill("19");
  await panel.getByLabel("第 2 局对方").fill("21");
  await expect(panel).toContainText("保存后推送给 Amy、Dan 确认");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-record.png` });
  await panel.getByRole("button", { name: "保存" }).click();
  await expect(panel).toBeHidden();
  expect(posts.at(-1)).toEqual([
    "/api/m/tok/events/1/scores",
    {
      doubles: true,
      partner: { id: "M001" },
      opponents: [{ id: "M004" }, { guest: "阿杰" }],
      games: [
        [21, 18],
        [19, 21],
      ],
    },
  ]);
});
