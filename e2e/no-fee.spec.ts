import { expect, test, type Page } from "@playwright/test";

/** 无需收款 on a player's card (the admin side and the API are covered by the unit tests). */
const event = {
  id: 9,
  code: "30-1024",
  date: "2030-10-24",
  startTime: "20:00",
  endTime: "22:30",
  location: "Bintang Badminton Center",
  address: "1234 Main St, Fremont, CA",
  title: "",
  notes: "",
  queueRoundMin: 45,
  noFee: true,
  deadlineAt: "2030-10-23T00:00:00Z",
  status: "closed",
  headcount: 12,
  myFriends: [],
  selfSignedUp: true,
  canEdit: false,
  friendCap: 2,
  organizer: "Arthur",
  runByMe: false,
  managerName: "Arthur",
  ownerName: "Jay",
  payment: null,
  roster: [
    { name: "Ke", friendOf: null, mine: true, absent: false },
    { name: "Arthur", friendOf: null, mine: false, absent: false },
  ],
  queue: null,
  courts: [],
};
const plain = { ...event, id: 10, code: "30-1026", date: "2030-10-26", noFee: false, status: "open" };
const past = {
  id: 5,
  code: "30-1001",
  date: "2030-10-01",
  title: "",
  location: "Bintang Badminton Center",
  amountCents: null,
  attended: true,
  friends: 0,
  paidBy: null,
  kcal: null,
  noFee: true,
};

async function open(page: Page) {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [event, plain], history: [past], friendCap: 2 } }),
  );
  await page.goto("/m/tok");
}

test("says how the court fee is paid, and keeps a closed 无需收款 event out of 待结清", async ({ page }) => {
  await open(page);
  const cards = page.locator(".ev-card");
  await expect(cards).toHaveCount(2);
  await expect(page.locator(".section-title", { hasText: "待结清" })).toHaveCount(0);
  await expect(cards.nth(0)).toContainText("每人自付场地费");
  await expect(cards.nth(1)).toContainText("活动后由组织者结算费用");
  await expect(page.locator(".mini-card")).toContainText("每人自付场地费");
  await page.screenshot({ path: test.info().outputPath("no-fee-member.png"), fullPage: true });
});
