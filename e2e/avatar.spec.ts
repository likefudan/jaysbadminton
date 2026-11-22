import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const PHOTO = "e2e/fixtures/avatar-photo.jpg";
const SHOTS = process.env.UI_REVIEW_SCREENSHOTS;
/** Screenshots only: a folder of f0.jpg… so each person gets their own face. */
const FACES = process.env.AVATAR_FACES;
const face = (i: number) => readFileSync(FACES ? `${FACES}/f${i % 6}.jpg` : PHOTO);

async function avatars(page: Page) {
  await page.route("**/api/public/avatars/*", (route) => {
    const i = Number(new URL(route.request().url()).pathname.split("/").pop()?.replace(/\D/g, "") || 0);
    return route.fulfill({ contentType: "image/jpeg", body: face(i) });
  });
}

const me = (o: object) => ({
  id: "M007",
  username: "Dawei",
  wechatNickname: "dawei",
  active: true,
  isOwner: false,
  avatar: null,
  avatarMode: "google",
  googlePicture: false,
  ...o,
});

/** 个人信息 → tap the avatar: pick a photo, move it into the circle, save a small square JPEG. */
test("a member crops a photo into their avatar, and can go back to none", async ({ page }) => {
  await avatars(page);
  let current = me({});
  let sent = "";
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) => route.fulfill({ json: current }));
  await page.route(/\/api\/m\/tok\/(profile|stats|calories|events|year)/, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "x" } } }),
  );
  await page.route("**/api/m/tok/avatar", (route) => {
    sent = route.request().postDataJSON().image;
    current = me({ avatar: "/api/public/avatars/a1", avatarMode: "own" });
    return route.fulfill({ json: { avatar: current.avatar } });
  });
  await page.route("**/api/m/tok/avatar/mode", (route) => {
    current = me({ avatar: null, avatarMode: route.request().postDataJSON().mode });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/m/tok/profile");
  // No Google account, no photo: the empty face.
  await expect(page.locator(".me-card .avatar svg")).toBeVisible();
  await page.locator(".me-card").getByRole("button", { name: "头像" }).click();
  const panel = page.getByRole("dialog", { name: "头像" });
  await expect(panel).toContainText("还没有头像");
  await expect(panel.getByRole("button", { name: "不用头像" })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-empty.png` });

  await panel.locator("input[type=file]").setInputFiles(PHOTO);
  const canvas = panel.locator(".crop-frame canvas");
  await expect(canvas).toBeVisible();
  // Zoom in a little and drag the face to the middle.
  await panel.getByRole("slider", { name: "缩放" }).fill("1.6");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 180, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 140, { steps: 4 });
  await page.mouse.up();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-crop.png` });
  await panel.getByRole("button", { name: "保存" }).click();

  // What goes up is a JPEG of a few KB, not the 30 KB photo picked.
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const bytes = Buffer.from(sent, "base64");
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  expect(bytes.length).toBeLessThan(40_000);
  await expect(panel.locator(".avatar-big img")).toHaveAttribute("src", "/api/public/avatars/a1");
  await expect(page.locator(".me-card .avatar img")).toBeVisible();
  if (SHOTS) {
    await page.getByRole("button", { name: "返回" }).click();
    await page.screenshot({ path: `${SHOTS}/3-profile.png` });
    await page.locator(".me-card").getByRole("button", { name: "头像" }).click();
  }
  await panel.getByRole("button", { name: "不用头像" }).click();
  await expect(panel).toContainText("现在不显示头像");
  await expect(panel.locator(".avatar-big svg")).toBeVisible();
});

type Rank = { rank: number; name: string; value: number; avatar?: string | null };
const KEYS = ["calories", "attendance", "hours", "progress", "streak", "friends", "queue", "early"];
const board = (list: Rank[]) => ({
  year: 2026,
  month: 11,
  boards: ["attendance", "hours"],
  ...Object.fromEntries(KEYS.map((k) => [k, []])),
  // 月度 is what shows first (Ke Li 2026-11-15).
  monthly: Object.fromEntries(KEYS.map((k) => [k, k === "attendance" ? list : []])),
});
const NAMES = ["Lina", "arturo", "Dawei", "Jayz", "Johnzhao", "josefa", "Tom"];

/** 排行榜: a face over each name on the podium and before it in the rows; none for visitors. */
test("the boards show avatars to members and names alone to visitors", async ({ page }) => {
  await avatars(page);
  let signedIn = true;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { signedIn, hasMember: signedIn, pending: false } }),
  );
  await page.route("**/api/public/home", (route) =>
    route.fulfill({
      json: {
        currentEvents: [],
        pastEvents: [],
        leaderboard: board(
          NAMES.map((name, i) => ({
            rank: i + 1,
            name,
            value: 30 - i * 3,
            ...(signedIn ? { avatar: i === 3 ? null : `/api/public/avatars/p${i}` } : {}),
          })),
        ),
      },
    }),
  );
  // A member's home page is 我的活动, with the boards under the event cards.
  await page.route("**/api/m/session/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Ke", wechatNickname: "ke", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/session/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.goto("/");
  const card = page.locator(".card.board");
  await expect(card.locator(".podium .avatar")).toHaveCount(3);
  await expect(card.locator(".podium .p1 .avatar img")).toHaveAttribute("src", "/api/public/avatars/p0");
  // Jayz has none: the empty face.
  await expect(card.locator(".board-rows li").first().locator(".avatar svg")).toBeVisible();
  if (SHOTS) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${SHOTS}/4-board.png` });
  }

  signedIn = false;
  await page.reload();
  await expect(card.locator(".podium .who")).toHaveCount(3);
  await expect(card.locator(".avatar")).toHaveCount(0);
});

/** 年度回顾 → 最常一起打球: their faces instead of the first letter. */
test("最常一起打球 shows the buddies' avatars", async ({ page }) => {
  await avatars(page);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: me({ avatar: "/api/public/avatars/m2", avatarMode: "own" }) }),
  );
  await page.route(/\/api\/m\/tok\/(profile|stats|calories|events)$/, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "x" } } }),
  );
  await page.route("**/api/m/tok/year*", (route) =>
    route.fulfill({
      json: {
        year: 2026,
        years: [2026],
        count: 32,
        hours: 68.5,
        kcal: 14820,
        early: 9,
        friends: 4,
        queue: 12,
        venue: { name: "Synergy Badminton Academy", count: 21 },
        buddies: [
          { name: "Lina", count: 18, avatar: "/api/public/avatars/b0" },
          { name: "arturo", count: 15, avatar: null },
          { name: "Jayz", count: 11, avatar: "/api/public/avatars/b4" },
        ],
        milestones: [],
      },
    }),
  );
  await page.goto("/m/tok/profile");
  const buddies = page.locator(".buddy");
  await expect(buddies).toHaveCount(3);
  await expect(buddies.nth(0).locator("img")).toHaveAttribute("src", "/api/public/avatars/b0");
  await expect(buddies.nth(1).locator(".avatar svg")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-year.png`, fullPage: true, animations: "disabled" });
});
