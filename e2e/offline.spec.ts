import { expect, test } from "@playwright/test";

/**
 * 没网也能打开 (Ke Li 2026-11-15): sw.js keeps the page and what it asked for, and hands them back
 * when the network is gone; the page says so in a line at the top. Against the real local site: a
 * service worker's requests are not the page's, so they can't be answered by the test.
 */
test("the site opens without network, showing what it had, and says so", async ({ page, context }) => {
  // The other tests run without the service worker (offline.ts).
  await page.addInitScript(() => {
    (window as { offlineTest?: boolean }).offlineTest = true;
  });
  // Whatever the home page shows (other tests may have made events): the same again without network.
  const shown = page.locator(".page-body .section-title, .page-body .empty").first();
  await page.goto("/");
  await expect(shown).toBeVisible();
  const text = await shown.innerText();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((done) => navigator.serviceWorker.addEventListener("controllerchange", done, { once: true }));
  });
  // Once more, now through the service worker, which keeps what comes back.
  await page.reload();
  await expect(shown).toHaveText(text);
  await expect(page.locator(".offline-banner")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("data-v1")).keys()).length))
    .toBeGreaterThan(1);

  await context.setOffline(true);
  await page.reload();
  await expect(shown).toHaveText(text);
  await expect(page.locator(".offline-banner")).toContainText("没有网络，显示的是");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/offline.png` });

  // Back online: the line goes away by itself.
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.locator(".offline-banner")).toHaveCount(0);
});
