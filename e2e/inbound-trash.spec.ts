import { expect, test } from "@playwright/test";

const row = (id: number, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "unmatched",
  state,
  payerName: `Tester ${id}`,
  amountCents: 1000 * id,
  note: "test",
  receivedAt: "2026-10-01T18:00:00Z",
  txnId: `T${id}`,
  reason: "这次活动还没结算",
  linked: null,
  deletedAt: null,
  ...extra,
});

test("已删除: delete a payment, restore one, and 清空 with the password", async ({ page }) => {
  const calls: string[] = [];
  const deletedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", (route) =>
    route.fulfill({
      json: {
        pending: [],
        active: [],
        inactive: [],
        deleted: [],
        organizers: null,
        viewer: {
          id: "M001",
          role: "owner",
          caps: ["owner", "data", "group", "events.create", "event", "payee", "members.read", "self"],
        },
      },
    }),
  );
  await page.route("**/api/admin/test-token/inbound", (route) =>
    route.fulfill({
      json: {
        open: [row(1, "open")],
        done: [],
        ignored: [row(4, "ignored")],
        deleted: [row(2, "deleted", { deletedAt }), row(3, "deleted", { deletedAt })],
        payments: [],
        refunds: [],
      },
    }),
  );
  await page.route("**/api/admin/test-token/inbound/**", (route) => {
    calls.push(
      `${new URL(route.request().url()).pathname.replace("/api/admin/test-token", "")} ${route.request().postData()}`,
    );
    return route.fulfill({ json: { ok: true } });
  });
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept();
  });

  await page.goto("/admin/test-token");
  await page.getByRole("button", { name: "收款", exact: true }).click();
  const trash = page.locator(".card", { has: page.getByRole("heading", { name: "已删除 (2)" }) });
  await expect(trash).toContainText("28 天后永久删除");

  // Into 已删除 without a dialog; restoring and deleting for good both ask first.
  await page
    .locator(".card", { has: page.getByRole("heading", { name: "待确认 (1)" }) })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("button", { name: "移回待确认" }).click();
  await trash.getByRole("button", { name: "恢复" }).first().click();
  await trash.getByRole("button", { name: "永久删除", exact: true }).first().click();
  await trash.getByRole("button", { name: "清空" }).click();
  await trash.getByLabel("群主密码").fill("pw");
  await trash.getByRole("button", { name: "永久删除全部 2 笔" }).click();

  await expect.poll(() => calls.length).toBe(5);
  expect(calls).toEqual([
    "/inbound/1/delete {}",
    "/inbound/4/unignore {}",
    "/inbound/2/restore {}",
    "/inbound/2/purge {}",
    '/inbound/trash/clear {"password":"pw"}',
  ]);
  expect(dialogs).toEqual([
    "恢复 Tester 2 $20.00 这笔收款？它会回到原来的列表。",
    "永久删除 Tester 2 $20.00 这笔收款？删除后无法恢复。",
    "永久删除「已删除」里的全部 2 笔收款？删除后无法恢复。",
  ]);
});
