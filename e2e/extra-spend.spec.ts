import { expect, test } from "@playwright/test";

const SHOTS = process.env.UI_REVIEW_SCREENSHOTS;

/**
 * 自付费用 (Ke Li 2026-11-14, option B): in 我的花费 › 明细 a member notes what they paid themselves
 * for an event; it adds to the totals, shows as its own line and tops the column.
 */
test("the member notes a drop-in fee in 明细 and it adds to their spending", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const daysAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
  const history = [
    { id: 1, date: daysAgo(5), title: "", location: "Synergy", cents: 1250, extraCents: 0, attended: true },
    { id: 2, date: daysAgo(2), title: "", location: "Bintang", cents: 0, extraCents: 0, attended: true },
  ];
  const saved: unknown[] = [];
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { enabled: false, signedIn: false, hasMember: false } }),
  );
  await page.route("**/api/m/tok/me", (route) =>
    route.fulfill({ json: { id: "M007", username: "Dafei", wechatNickname: "dafei", active: true, isOwner: false } }),
  );
  await page.route("**/api/m/tok/events", (route) =>
    route.fulfill({ json: { events: [], history: [], friendCap: 3 } }),
  );
  await page.route("**/api/m/tok/profile", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "x" } } }),
  );
  await page.route("**/api/m/tok/stats/extra", async (route) => {
    const body = route.request().postDataJSON() as { eventId: number; cents: number };
    saved.push(body);
    history.find((h) => h.id === body.eventId)!.extraCents = body.cents;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/m/tok/stats", (route) =>
    route.fulfill({
      json: {
        year: 2026,
        yearCount: 2,
        totalCount: 2,
        yearSpendCents: 0,
        avgSpendCents: 0,
        lastYearCount: 0,
        lastYearSpendCents: 0,
        today,
        history,
      },
    }),
  );
  await page.goto("/m/tok/profile");
  await page.getByRole("button", { name: /我的花费/ }).click();
  const card = page.locator(".card.spend");
  await card.getByRole("button", { name: "30D" }).click();
  const figures = card.locator(".spend-figures");
  await expect(figures).toContainText("$12.50");
  await expect(card.locator(".spend-split")).toHaveCount(0);

  await card.getByText("明细（2 场）").click();
  await card.getByRole("button", { name: "＋自付" }).first().click(); // newest first: Bintang
  const input = card.getByLabel("自付费用");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-typing.png` });
  await input.fill("abc");
  await card.getByRole("button", { name: "保存" }).click();
  await expect(card.locator(".spend-extra-hint")).toHaveText("请输入金额，比如 15");
  await input.fill("15");
  await card.getByRole("button", { name: "保存" }).click();

  await expect(card.getByRole("button", { name: "自付 $15.00" })).toBeVisible();
  expect(saved).toEqual([{ eventId: 2, cents: 1500 }]);
  await expect(figures).toContainText("$27.50");
  await expect(card.locator(".spend-split")).toContainText("群里收 $12.50");
  await expect(card.locator(".spend-split")).toContainText("自付 $15.00");
  await expect(card.locator(".spend-bar-extra")).toHaveCount(1);
  // Only 自付 on this one: the bill column reads — rather than $0.00.
  await expect(card.locator(".spend-detail td.num")).toHaveText(["—", "$12.50"]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-spend.png` });

  // Change it back to nothing.
  await card.getByRole("button", { name: "自付 $15.00" }).click();
  await card.getByRole("button", { name: "清除" }).click();
  await expect(card.getByRole("button", { name: "＋自付" })).toHaveCount(2);
  expect(saved.at(-1)).toEqual({ eventId: 2, cents: 0 });
  await expect(figures).toContainText("$12.50");
});
