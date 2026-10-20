import { expect, test, type Page } from "@playwright/test";

/** 预定场地 on a player's card (set from the admin page; the API is covered by the unit tests). */
const event = {
  id: 9,
  code: "1024",
  date: "2030-10-24",
  startTime: "20:00",
  endTime: "22:30",
  location: "Synergy Badminton",
  address: "1234 Main St, Fremont, CA",
  title: "",
  notes: "",
  queueRoundMin: null,
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
  courts: [3, 5, 12],
};

async function open(page: Page, courts: number[]) {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false, hasMember: false } }));
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  for (const path of ["profile", "stats", "push"])
    await page.route(`**/api/m/tok/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: { message: "x" } } }),
    );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [{ ...event, courts }], history: [], friendCap: 2 } }),
  );
  await page.goto("/m/tok");
}

test("shows the booked courts on the card of an event one is on", async ({ page }) => {
  await open(page, [3, 5, 12]);
  const card = page.locator(".ev-card");
  await expect(card.locator(".ev-courts")).toHaveText("场地：3、5、12 号");
  await card.screenshot({ path: test.info().outputPath("booked-courts-card.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await card.screenshot({ path: test.info().outputPath("booked-courts-card-dark.png") });
});

test("shows no courts line until they are set", async ({ page }) => {
  await open(page, []);
  await expect(page.locator(".ev-card .ev-meta").first()).toBeVisible();
  await expect(page.locator(".ev-courts")).toHaveCount(0);
});
