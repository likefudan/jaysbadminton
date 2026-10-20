import { expect, test, type Page } from "@playwright/test";

const base = {
  startTime: "20:30",
  endTime: "22:30",
  location: "Synergy",
  address: "",
  title: "",
  deadlineAt: "2030-01-01T00:00:00Z",
  headcount: 3,
  myFriends: [] as string[] | null,
  selfSignedUp: true,
  canEdit: false,
  friendCap: 2,
  organizer: null,
  runByMe: false,
  managerName: "Jay",
  ownerName: "Jay",
  payment: null as object | null,
  roster: null,
};
const bill = (status: string) => ({
  amountCents: 1200,
  paidCents: status === "paid" ? 1200 : 0,
  refundCents: 0,
  status,
  code: "X",
  shares: [],
  payeeName: "Jay",
  venmoUsername: "jay",
  zelleAccount: "",
});
const ev = (id: number, date: string, title: string, o: object) => ({ ...base, id, code: `E${id}`, date, title, ...o });

/** 我的活动 in Ke Li's three parts, whatever the dates: 报名中, 待结清, 已结清. */
export async function memberEvents(page: Page) {
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
        events: [
          // Newest first, as the server sends them.
          ev(6, "2030-11-10", "提前结清", { status: "settled", payment: bill("paid") }),
          ev(5, "2030-11-03", "还能报名", { status: "open", myFriends: null, selfSignedUp: false, canEdit: true }),
          ev(4, "2030-10-27", "已报名", {
            status: "open",
            canEdit: true,
            myFriends: ["朋友"],
            roster: [
              { name: "Ke", friendOf: null, mine: true, absent: false },
              { name: "Ke的朋友1", friendOf: "Ke", mine: true, absent: false },
              { name: "arthur", friendOf: null, mine: false, absent: false },
            ],
          }),
          ev(3, "2030-10-20", "已截止", { status: "closed" }),
          ev(2, "2030-10-13", "待付款", { status: "finalized", payment: bill("unpaid") }),
        ],
        history: [
          {
            id: 1,
            code: "E1",
            date: "2030-10-06",
            title: "以前",
            location: "Synergy",
            amountCents: 1100,
            attended: true,
            friends: 0,
          },
        ],
        friendCap: 2,
      },
    }),
  );
}

test("我的活动 groups events into 报名中, 待结清 and 已结清, each in its own order", async ({ page }) => {
  await memberEvents(page);
  await page.goto("/m/tok");
  const titles = page.locator("main .section-title");
  await expect(titles).toHaveText(["报名中", "待结清", "已结清"]);
  // 报名中 and 待结清 soonest first; 已结清 newest first, the future event settled early included.
  await expect(page.locator(".ev-card .hero-what")).toHaveText([
    "已报名 · Synergy",
    "还能报名 · Synergy",
    "待付款 · Synergy",
    "已截止 · Synergy",
  ]);
  await expect(page.locator(".mini-card .mini-title")).toHaveText(["提前结清", "以前"]);
  await expect(page.locator(".mini-card").first()).toContainText("已付清 $12.00");
  // Their own events in the accent colour until billed (closed ones too), one they could join in the light one, billed ones plain.
  await expect(page.locator(".ev-card", { hasText: "已报名 ·" })).toHaveClass(/tone-hero/);
  await expect(page.locator(".ev-card", { hasText: "还能报名" })).toHaveClass(/tone-soft/);
  await expect(page.locator(".ev-card", { hasText: "已截止 ·" })).toHaveClass(/tone-hero/); // closed, but they're on it
  await expect(page.locator(".ev-card", { hasText: "待付款 ·" })).toHaveClass(/tone-plain/);
  // Their own ones say so with a tick: 我已报名, then （已截止） once closed, （请付款） while the bill is open.
  await expect(page.locator(".ev-card .hero-top .status")).toHaveText([
    "我已报名",
    "报名中",
    "我已报名（请付款）",
    "我已报名（已截止）",
  ]);
  await expect(page.locator(".ev-card .status-mine")).toHaveCount(3);
});
