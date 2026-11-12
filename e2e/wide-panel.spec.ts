import { expect, test } from "@playwright/test";

/**
 * An unfolded iPhone Duo held sideways (and any screen 800 wide or more): a panel takes the right
 * half, clear of the crease in the middle, and the page stays readable on the left.
 */
test("on a wide screen a panel opens over the right half", async ({ page }) => {
  await page.setViewportSize({ width: 890, height: 626 });
  await page.goto("/privacy");
  await page.locator(".topbar-actions button").last().click();
  const panel = page.locator(".panel");
  await expect(panel).toBeVisible();
  // After the slide-in.
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(445);
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(890);
  expect(Math.round(box.height)).toBe(626);
  // Nothing sticks out sideways (iPhone Safari would zoom the whole page out).
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(890);
  await page.getByRole("button", { name: "返回" }).click();
  await expect(panel).toHaveCount(0);
});

test("on a phone a panel still covers the whole screen", async ({ page }) => {
  await page.goto("/privacy");
  await page.locator(".topbar-actions button").last().click();
  const box = (await page.locator(".panel").boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
});
