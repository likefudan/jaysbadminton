import { expect, test } from "@playwright/test";

const review = (year: number) => ({
  year,
  years: [2026, 2025],
  count: year === 2026 ? 32 : 7,
  hours: 68.5,
  kcal: year === 2026 ? 14820 : null,
  early: 9,
  friends: 4,
  queue: 12,
  venue: { name: "Synergy Badminton Academy", count: 21 },
  buddies: [
    { name: "Lina", count: 18 },
    { name: "arturo", count: 15 },
  ],
  milestones: [
    { key: "attendance", value: 24, tier: 2 },
    { key: "hours", value: 112, tier: 2 },
    { key: "streak", value: 11, tier: 2 },
    { key: "early", value: 9, tier: 1 },
    { key: "friends", value: 2, tier: 0 },
    { key: "queue", value: 230, tier: 3 },
  ],
});

/** 年度回顾 on 个人信息 (option P): the year's card, earlier years, badges, 最常一起打球, 分享 as an image. */
test("the year card switches years, shows the badges, and shares an image", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dawei", wechatNickname: "dawei", active: true, isOwner: false } }),
  );
  await page.route(/\/api\/m\/tok\/(profile|stats|calories|events)$/, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "x" } } }),
  );
  await page.route("**/api/m/tok/year*", (route) =>
    route.fulfill({ json: review(new URL(route.request().url()).searchParams.get("year") === "2025" ? 2025 : 2026) }),
  );
  await page.goto("/m/tok/profile");
  // Inside the top card, under their name (option C).
  const card = page.locator(".me-card .year-card");
  await expect(page.locator(".me-card")).toContainText("Dawei");
  await expect(card).toContainText("你的 2026");
  await expect(card).toContainText("14,820");
  await expect(card).toContainText("Synergy Badminton Academy");

  // Earlier years from the arrows; without calories that year, 带朋友 takes the tile.
  await expect(page.getByRole("button", { name: "下一年" })).toBeDisabled();
  await page.getByRole("button", { name: "上一年" }).click();
  await expect(card).toContainText("你的 2025");
  await expect(card).toContainText("人次带朋友");

  // Each badge shows the level reached, or the first one greyed out, and the way to the next.
  const medals = page.locator(".medal");
  await expect(medals).toHaveCount(6);
  await expect(medals.first()).toContainText("出勤");
  await expect(medals.first()).toHaveAttribute("title", "出勤 20 次");
  await expect(medals.first()).toContainText("24 / 50");
  await expect(page.locator(".medal.locked")).toHaveCount(1);
  await expect(page.locator(".medal.locked")).toHaveAttribute("title", "带朋友 3 人次");
  await expect(medals.last()).toContainText("230");

  // Tapping a badge explains it: what counts, all-time, the three levels, how far the next is.
  await medals.first().click();
  const info = page.getByRole("dialog", { name: "出勤" });
  await expect(info).toContainText("来打球的次数");
  await expect(info).toContainText("累计 24 次");
  await expect(info.locator(".badge-tiers .got")).toHaveCount(2);
  await expect(info).toContainText("还差 26 次升到金牌");
  await page.mouse.click(10, 10);
  await expect(info).toBeHidden();

  await expect(page.locator(".buddy")).toHaveText([/Lina.*18/, /arturo.*15/]);

  await card.getByRole("button", { name: "分享" }).click();
  const img = page.locator("img.sharecard");
  await expect(img).toHaveAttribute("src", /^data:image\/png/);
  // The group's QR code is on the card unless they turn it off (Ke Li 2026-11-19); the phone remembers.
  const qr = page.getByRole("switch", { name: "显示二维码" });
  await expect(qr).toBeChecked();
  const withQr = await img.getAttribute("src");
  await qr.click();
  await expect(img).not.toHaveAttribute("src", withQr!);
  expect(await page.evaluate(() => localStorage.getItem("year-card-qr"))).toBe("0");
  await expect(page.getByText("手机上长按图片即可保存或转发")).toBeVisible();
});
