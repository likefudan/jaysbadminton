import { expect, test } from "@playwright/test";

const SHOTS = process.env.UI_REVIEW_SCREENSHOTS;

const event = (likes: object) => ({
  id: 1,
  code: "26-1110",
  date: "2030-11-10",
  startTime: "19:00",
  endTime: "21:00",
  location: "Synergy",
  address: "",
  title: "",
  status: "closed",
  deadlineAt: "2030-11-09T00:00:00Z",
  headcount: 5,
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
  likes,
});

const people = ["Amy", "Bob", "Cat", "Dan", "Eve", "Fay"].map((name, i) => ({
  id: `M00${i + 1}`,
  name,
  avatar: null,
  liked: false,
}));

/** 点赞 (Ke Li 2026-11-11): from the card, up to 3 people, then the card shows how many were given. */
test("a member likes up to 3 others after the event, anonymously", async ({ page }) => {
  let liked = new Set<string>();
  const state = () => ({
    open: true,
    hours: 24,
    max: 3,
    given: liked.size,
    received: 2,
    people: people.map((p) => ({ ...p, liked: liked.has(p.id) })),
  });
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
        events: [event({ open: true, max: 3, given: liked.size, received: 2 })],
        history: [
          {
            id: 9,
            code: "E9",
            date: "2030-11-03",
            title: "",
            location: "Synergy",
            amountCents: 1100,
            attended: true,
            friends: 0,
            kcal: null,
            likes: 4,
            likeOpen: false,
            noFee: false,
            unsettled: false,
            paidBy: null,
          },
        ],
        friendCap: 2,
      },
    }),
  );
  await page.route("**/api/m/tok/events/1/likes", (route) => {
    const body = route.request().postDataJSON();
    if (body) {
      liked = new Set(liked);
      if (body.on) liked.add(body.to);
      else liked.delete(body.to);
    }
    return route.fulfill({ json: state() });
  });

  await page.goto("/m/tok");
  const row = page.locator(".like-row");
  await expect(row).toContainText("收到 2 个赞");
  await expect(row).toContainText("这场最多 3 个，匿名");
  await expect(page.locator(".mini-likes")).toContainText("4");
  if (SHOTS) await row.scrollIntoViewIfNeeded().then(() => page.screenshot({ path: `${SHOTS}/1-card.png` }));

  await row.getByRole("button", { name: "点个赞" }).click();
  const panel = page.getByRole("dialog", { name: "点赞" });
  await expect(panel).toContainText("还能点 3 个");
  for (const name of ["Amy", "Cat", "Eve"]) await panel.getByRole("button", { name }).click();
  await expect(panel).toContainText("3 个赞都点完了");
  await expect(panel.getByRole("button", { name: "Bob" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Amy" })).toHaveAttribute("aria-pressed", "true");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-panel.png` });

  await panel.getByRole("button", { name: "返回" }).click();
  await expect(row).toContainText("你点了 3 个赞");
  await expect(row.getByRole("button", { name: "修改" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-after.png` });
});
