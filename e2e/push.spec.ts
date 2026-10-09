import { expect, test, type Page } from "@playwright/test";

/**
 * 推送通知 on a member's pages. The browser's push service is stubbed (a test browser has none);
 * what's checked is the page: the offer on 我的活动, the card on 个人信息, and what they send.
 */
async function member(page: Page) {
  const sent: { path: string; body: any }[] = [];
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
  await page.route("**/api/m/tok/stats", (route) => route.fulfill({ status: 503, json: { error: { message: "x" } } }));
  await page.route("**/api/m/tok/push", (route) =>
    // Any valid P-256 point will do for the stub.
    route.fulfill({
      json: {
        publicKey: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      },
    }),
  );
  await page.route("**/api/m/tok/push/*", async (route) => {
    sent.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(() => {
    // Kept across reloads, as a real subscription is.
    const fake = () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => {
        localStorage.removeItem("fake-push");
        return true;
      },
    });
    PushManager.prototype.subscribe = async () => {
      localStorage.setItem("fake-push", "1");
      return fake() as any;
    };
    PushManager.prototype.getSubscription = async () => (localStorage.getItem("fake-push") ? (fake() as any) : null);
  });
  return sent;
}

test("我的活动 offers push once; 不用了 keeps it away", async ({ page }) => {
  await member(page);
  await page.goto("/m/tok");
  const offer = page.getByText("开启推送，新活动开始报名、账单出来时第一时间知道。");
  await expect(offer).toBeVisible();
  await page.getByRole("button", { name: "不用了" }).click();
  await expect(offer).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "你好，Dafei" })).toBeVisible();
  await expect(offer).toBeHidden();
});

test("个人信息 turns push on and off for this browser", async ({ page, context }) => {
  const sent = await member(page);
  await context.grantPermissions(["notifications"]);
  await page.goto("/m/tok/profile");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "推送通知" }) });
  await card.getByRole("button", { name: "开启推送" }).click();
  await expect(card.getByRole("button", { name: "关闭推送" })).toBeVisible();
  expect(sent).toEqual([
    {
      path: "/api/m/tok/push/subscribe",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "p", auth: "a" }, welcome: true },
    },
  ]);
  // The service worker that shows them is registered, and knows which page a tap opens.
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/"))?.active)).toBe(true);
  expect(await page.evaluate(async () => (await (await caches.open("push")).match("/push-home"))?.text())).toBe(
    "/m/tok",
  );

  // Someone else's page in this browser (another member turned it on here) doesn't take it over.
  await page.evaluate(async () => (await caches.open("push")).put("/push-member", new Response("M999")));
  await page.reload();
  await expect(card.getByRole("button", { name: "改为推送给我" })).toBeVisible();
  await page.evaluate(async () => (await caches.open("push")).put("/push-member", new Response("M007")));
  await page.reload();

  await card.getByRole("button", { name: "关闭推送" }).click();
  await expect(card.getByRole("button", { name: "开启推送" })).toBeVisible();
  expect(sent.at(-1)).toEqual({
    path: "/api/m/tok/push/unsubscribe",
    body: { endpoint: "https://fcm.googleapis.com/fcm/send/test" },
  });
});
