import { expect, test } from "@playwright/test";
import { BOARD_KEYS, type BoardKey } from "../src/shared/types";

test("admin reorders boards with touch, mouse and keyboard; failed saves restore the order", async ({ page }) => {
  let order: BoardKey[] = [...BOARD_KEYS];
  let fail = false;
  const empty = Object.fromEntries(BOARD_KEYS.map((k) => [k, []]));
  const preview = Object.fromEntries(
    BOARD_KEYS.map((k) => [
      k,
      k === "calories"
        ? []
        : [
            { rank: 1, name: "Terrence", value: k === "progress" ? 4 : 27 },
            { rank: 2, name: "Christine", value: 3 },
            { rank: 3, name: "Ke", value: 2 },
          ],
    ]),
  );
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (r) =>
    r.fulfill({ json: { pending: [], active: [], inactive: [], deleted: [], viewer: { caps: ["owner"] } } }),
  );
  await page.route("**/api/admin/test-token/telegram", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/admin/test-token/settings", async (r) => {
    if (r.request().method() === "POST") {
      if (fail) return r.fulfill({ status: 503, json: { error: { message: "保存失败" } } });
      order = r.request().postDataJSON().leaderboardOrder ?? order;
    }
    return r.fulfill({ json: {} });
  });
  await page.route("**/api/admin/test-token/leaderboard", (r) =>
    r.fulfill({
      json: {
        board: { ...preview, year: 2026, month: 11, monthly: empty, boards: order },
        public: [...BOARD_KEYS],
        anon: false,
      },
    }),
  );
  const visit = () => page.goto("/admin/test-token?tab=settings&sub=boards");
  await visit();
  const names = page.locator(".board-open .name");
  const handles = page.locator(".board-handle");
  await expect(names.first()).toHaveText("能量");
  if (process.env.UI_REVIEW_SCREENSHOTS) {
    await page.screenshot({
      path: `${process.env.UI_REVIEW_SCREENSHOTS}/leaderboard-order.png`,
      fullPage: true,
      animations: "disabled",
    });
  }

  // A real touch gesture in the phone viewport, rather than HTML drag-and-drop.
  const first = (await handles.first().boundingBox())!;
  const third = (await handles.nth(2).boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const x = first.x + first.width / 2;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: first.y + first.height / 2 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: third.y + third.height / 2 + 5 }],
  });
  await expect(names.nth(2)).toHaveText("能量");
  if (process.env.UI_REVIEW_SCREENSHOTS) {
    await page.screenshot({
      path: `${process.env.UI_REVIEW_SCREENSHOTS}/leaderboard-dragging.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  if (process.env.UI_REVIEW_SCREENSHOTS) {
    await page
      .locator(".board-list")
      .screenshot({ path: `${process.env.UI_REVIEW_SCREENSHOTS}/leaderboard-detail.png`, animations: "disabled" });
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(names).toHaveText(["出勤", "时长", "能量", "进步", "连续", "带朋友", "排队功臣", "早鸟", "点赞"]);
  await expect.poll(() => order[2]).toBe("calories");
  await visit();
  await expect(names.nth(2)).toHaveText("能量");

  const a = (await handles.nth(2).boundingBox())!;
  const b = (await handles.first().boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order[0]).toBe("calories");
  await expect(names.first()).toHaveText("能量");
  await expect(handles.first()).toHaveAttribute("aria-disabled", "false");
  await handles.first().press("ArrowDown");
  await expect.poll(() => order[0]).toBe("attendance");
  await expect(names.first()).toHaveText("出勤");
  const energyHandle = page.locator('[data-board="calories"] .board-handle');
  await expect(energyHandle).toBeFocused();
  await expect(energyHandle).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => order[2]).toBe("calories");
  await expect(energyHandle).toBeFocused();

  await expect(handles.first()).toHaveAttribute("aria-disabled", "false");
  const saved = [...order];
  await page.setViewportSize({ width: 390, height: 650 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const start = (await handles.first().boundingBox())!;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x + 20, y: start.y + 20 }],
  });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 20, y: 635 }] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(80);
  await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(page.locator(".board-item.sorting")).toHaveCount(0);
  await expect(energyHandle).toHaveAttribute("aria-disabled", "false");
  expect(order).toEqual(saved);
  await expect(names).toHaveText(["出勤", "时长", "能量", "进步", "连续", "带朋友", "排队功臣", "早鸟", "点赞"]);
  // The cancelled animation must stop scrolling too.
  const stoppedAt = await page.evaluate(() => scrollY);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(await page.evaluate(() => scrollY)).toBe(stoppedAt);

  fail = true;
  await handles.first().press("ArrowDown");
  await expect(page.getByRole("alert")).toHaveText("保存失败");
  await expect(handles.first()).toBeFocused();
  await expect(names.first()).toHaveText("出勤");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
