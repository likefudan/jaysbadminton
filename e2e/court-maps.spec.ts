import { expect, test, type Page } from "@playwright/test";
import { plan } from "./fixtures/courtPlan";

/**
 * 设置 → 球场图 (Ke Li 2026-11-15: 在设置里管理，活动卡片上只是用来看): the venues we play at, each
 * with one plan read from a photo, put right in the editor, replaced, removed or brought back.
 */
const BINTANG = { venue: "Bintang Fremont", address: "48900 Milmont Dr, Fremont, CA 94538" };
const SYNERGY = { venue: "Synergy Badminton", address: "" };
const API = "**/api/admin/test-token";
/** When the photo was sent: 10/20 20:05 Pacific. */
const SENT = "2030-10-21T03:05:00Z";

/** `recent` false: Bintang is no longer on 最近的场馆, so it is listed only while it has a plan. */
async function setUp(page: Page, bintangMap: object | null, recent = true) {
  // `read`: what Bintang's last photo came to, as the reader in the background leaves it.
  const posts: { url: string; body: any }[] & { read?: object | null } = [];
  let map = bintangMap;
  await page.route("**/api/auth/session", (r) => r.fulfill({ json: { signedIn: false } }));
  await page.route(`${API}/members`, (r) =>
    r.fulfill({ json: { pending: [], active: [], inactive: [], deleted: [], viewer: { caps: ["owner"] } } }),
  );
  await page.route(`${API}/events?*`, (r) => r.fulfill({ json: { current: [], past: [], morePast: false } }));
  await page.route(`${API}/telegram`, (r) => r.fulfill({ json: {} }));
  await page.route(`${API}/settings`, (r) => r.fulfill({ json: {} }));
  await page.route(`${API}/court-maps`, (r) =>
    r.fulfill({
      json: {
        photo: true,
        venues: [
          ...(map || recent || posts.read
            ? [
                {
                  ...BINTANG,
                  map,
                  updatedAt: map ? "2030-10-21T03:00:00Z" : null,
                  savedBy: map ? "Jay" : null,
                  read: posts.read ?? null,
                },
              ]
            : []),
          { ...SYNERGY, map: null, updatedAt: null, savedBy: null, read: null },
        ],
      },
    }),
  );
  await page.route(`${API}/court-maps/**`, (route) => {
    const url = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    posts.push({ url, body });
    if (url.endsWith("/photo")) posts.read = { state: "pending", by: "Ke Li", at: SENT, layout: null };
    if (url.endsWith("/drop") || body.read) posts.read = null;
    if (url.endsWith("/save")) map = body.layout;
    if (url.endsWith("/remove")) map = null;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin/test-token?tab=settings&sub=courtMaps");
  return posts;
}

test("设置 → 球场图: a photo is read in the background; back later, its plan is checked, put right and saved", async ({
  page,
}) => {
  const posts = await setUp(page, null);
  const read = { aspect: 1.39, items: [...plan.items.slice(0, 3), { ...plan.items[3]!, label: "84" }] };
  // Each venue is a row, with its address and whether it has a plan.
  const row = page.getByRole("button", { name: /Bintang Fremont/ });
  await expect(row).toContainText("48900 Milmont Dr, Fremont, CA 94538");
  await expect(row).toContainText("未添加");
  await page.screenshot({ path: test.info().outputPath("court-maps-list.png"), animations: "disabled" });
  await row.click();
  const map = page.getByRole("dialog", { name: "球场图" });
  await expect(map.getByText("「Bintang Fremont」还没有球场图。")).toBeVisible();
  // A tiny PNG stands in for the photo.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await map
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "map.png", mimeType: "image/png", buffer: png });
  // Sent: it is read in the background (Ke Li: 拍了之后可以返回其他页面，过一会儿回来看结果), and
  // the venue says who sent it and when. No second photo meanwhile.
  await expect(map.locator(".cm-read")).toContainText("Ke Li 10/20 20:05 拍的照片正在识别");
  await expect(map.locator('input[type="file"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("court-map-reading.png"), animations: "disabled" });
  await map.locator(".panel-back").click();
  await expect(row).toContainText("正在识别…");
  // Off to another page and back: by then the reader has finished, and the row says so.
  await page.locator(".sub-bar").getByRole("button", { name: "设置" }).click();
  await expect(row).toHaveCount(0);
  posts.read = { state: "ready", by: "Ke Li", at: SENT, layout: read };
  await page.getByRole("button", { name: /^球场图/ }).click();
  await expect(row).toContainText("识别好了，待核对");
  await row.click();
  await expect(map.locator(".cm-read")).toContainText("Ke Li 10/20 20:05 拍的照片识别好了");
  await page.screenshot({ path: test.info().outputPath("court-map-ready.png"), animations: "disabled" });
  await map.getByRole("button", { name: "查看并核对" }).click();
  await expect(map.locator(".cm-item.court")).toHaveCount(4);
  const box = (label: string) => map.getByRole("button", { name: label, exact: true });

  // A wrong number: picked, retyped. A number used twice isn't saved.
  await box("84").click();
  await map.getByLabel("编号").fill("53");
  await map.getByRole("button", { name: "保存" }).click();
  await expect(map.getByText("有两片场地都是 53 号，请改掉一个")).toBeVisible();
  await map.getByLabel("编号").fill("47");

  // Dragged roughly under 52: it lands exactly on 52's column, never in between or at an angle.
  const from = (await box("47").boundingBox())!;
  const under = (await box("52").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(under.x + under.width / 2 + 7, from.y + from.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect((await box("47").boundingBox())!.x).toBeCloseTo(under.x, 0);
  // An arrow moves it one step; a new court takes the first free number.
  const before = (await box("47").boundingBox())!.y;
  await map.getByRole("button", { name: "下移" }).click();
  expect((await box("47").boundingBox())!.y).toBeGreaterThan(before);
  await map.getByRole("button", { name: "＋ 添加场地" }).click();
  await expect(map.getByLabel("编号")).toHaveValue("1");
  await page.screenshot({ path: test.info().outputPath("court-map-edit.png"), animations: "disabled" });

  await map.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/save"))).toBeTruthy();
  const saved = posts.find((p) => p.url.endsWith("/save"))!.body;
  expect(saved).toMatchObject({ ...BINTANG, read: true });
  expect(saved.layout.items.map((i: { label: string }) => i.label)).toEqual(["53", "52", "51", "47", "1"]);
  const [c52, c47] = [saved.layout.items[1], saved.layout.items[3]];
  expect(c47.x).toBe(c52.x);
  expect(c47.w).toBe(c52.w);
  // Saved: the venue's plan is shown with who saved it and when, and its row says so.
  await expect(map.getByRole("button", { name: "修改" })).toBeVisible();
  await expect(map.locator(".cm-saved")).toHaveText("Jay 于 10/20 20:00 保存");
  await expect(map.locator(".cm-read")).toHaveCount(0);
  await map.locator(".panel-back").click();
  await expect(row).toContainText("5 片");
});

test("设置 → 球场图: 修改 opens the kept plan in the editor, 删除 takes it off the venue", async ({ page }) => {
  const posts = await setUp(page, plan, false);
  const row = page.getByRole("button", { name: /Bintang Fremont/ });
  await expect(row).toContainText("53 片 · 2030年10月20日");
  await row.click();
  const map = page.getByRole("dialog", { name: "球场图" });
  await page.screenshot({ path: test.info().outputPath("court-maps-venue.png"), animations: "disabled" });
  await map.getByRole("button", { name: "修改" }).click();
  await map.getByRole("button", { name: "53", exact: true }).click();
  await map.getByRole("button", { name: "删除" }).click();
  await expect(map.locator(".cm-item.court")).toHaveCount(52);
  await map.getByRole("button", { name: "取消" }).click();
  await expect(map.locator(".cm-item.court")).toHaveCount(53);
  page.once("dialog", (d) => d.accept());
  await map.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/remove"))?.body).toEqual(BINTANG);
  await expect(map.getByText("「Bintang Fremont」还没有球场图。")).toBeVisible();
  // Off the list now, but still open, so 以前的图 can bring the plan back.
  await expect(page.getByRole("button", { name: /Bintang Fremont/ })).toHaveCount(0);
  await expect(map.getByRole("button", { name: "以前的图" })).toBeVisible();
});

test("设置 → 球场图: 以前的图 lists what was replaced; 恢复 opens one in the editor to save again", async ({
  page,
}) => {
  const posts = await setUp(page, plan);
  const older = { aspect: 1.39, items: plan.items.slice(0, 6) };
  await page.route(`${API}/court-maps/history`, (route) =>
    route.fulfill({
      json: {
        history: [
          { id: 2, layout: older, savedBy: "Jay", savedAt: "2030-10-20T03:05:00Z", replacedAt: "2030-10-21T03:00:00Z" },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: /Bintang Fremont/ }).click();
  const map = page.getByRole("dialog", { name: "球场图" });
  await map.getByRole("button", { name: "以前的图" }).click();
  await expect(map.getByText("Jay 保存 · 6 片场地")).toBeVisible();
  await expect(map.getByText("10/19 20:05")).toBeVisible();
  await map.getByRole("button", { name: "恢复" }).click();
  await expect(map.locator(".cm-item.court")).toHaveCount(6);
  await map.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/save"))).toBeTruthy();
  expect(posts.find((p) => p.url.endsWith("/save"))!.body.layout.items).toHaveLength(6);
});

test("设置 → 球场图: 裁剪 keeps only the courts in the range dragged out", async ({ page }) => {
  const posts = await setUp(page, plan);
  await page.getByRole("button", { name: /Bintang Fremont/ }).click();
  const map = page.getByRole("dialog", { name: "球场图" });
  await map.getByRole("button", { name: "修改" }).click();
  await map.getByRole("button", { name: "裁剪" }).click();
  await expect(map.getByRole("button", { name: "确定裁剪" })).toBeDisabled();
  // Over the top two rows (53–48 and 47–41), ending above the BADMINTON COURTS label.
  const box = (await map.locator(".cm-crop").boundingBox())!;
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 5 });
    await page.mouse.up();
  };
  // A range with only the label in the aisle says so and changes nothing.
  await drag(0.3, 0.25, 0.7, 0.31);
  await map.getByRole("button", { name: "确定裁剪" }).click();
  await expect(map.getByText("选的范围里没有场地，请重新拖一个范围")).toBeVisible();
  await drag(0.02, 0.01, 0.98, 0.2);
  await page.screenshot({ path: test.info().outputPath("court-map-crop.png"), animations: "disabled" });
  await map.getByRole("button", { name: "确定裁剪" }).click();
  await expect(map.locator(".cm-item")).toHaveCount(13);
  await page.screenshot({ path: test.info().outputPath("court-map-cropped.png"), animations: "disabled" });
  await map.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/save"))).toBeTruthy();
  const saved = posts.find((p) => p.url.endsWith("/save"))!.body.layout;
  expect(saved.items.map((i: { label: string }) => Number(i.label)).sort((a: number, b: number) => a - b)).toEqual(
    Array.from({ length: 13 }, (_, k) => 41 + k),
  );
  expect(saved.aspect).toBeGreaterThan(4);
});

test("设置 → 球场图: the list looks again by itself while a photo is being read, and says when it couldn't be", async ({
  page,
}) => {
  const posts = await setUp(page, plan);
  posts.read = { state: "pending", by: "Ke Li", at: SENT, layout: null };
  await page.reload();
  const row = page.getByRole("button", { name: /Bintang Fremont/ });
  await expect(row).toContainText("正在识别…");
  await row.click();
  const map = page.getByRole("dialog", { name: "球场图" });
  await expect(map.locator(".cm-read")).toContainText("正在识别");
  // The reader finishes without a plan: within a few seconds the open venue says so.
  posts.read = { state: "none", by: "Ke Li", at: SENT, layout: null };
  await expect(map.locator(".cm-read")).toContainText("Ke Li 10/20 20:05 拍的照片上没有找到球场图", { timeout: 8000 });
  await map.getByRole("button", { name: "知道了" }).click();
  await expect.poll(() => posts.find((p) => p.url.endsWith("/photo/drop"))?.body).toEqual(BINTANG);
  await expect(map.locator(".cm-read")).toHaveCount(0);
  await expect(map.locator('input[type="file"]')).toHaveCount(2);
});
