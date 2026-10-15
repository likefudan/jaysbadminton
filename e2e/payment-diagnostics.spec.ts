import { expect, test } from "@playwright/test";

test("Owner can enable diagnosis, inspect the failed layer and disable recording", async ({ page }) => {
  let enabled = false;
  const changes: boolean[] = [];
  const records = [
    {
      id: 7,
      receivedAt: new Date().toISOString(),
      outcome: "review",
      subject: "Bob paid $56.00 to your Venmo account",
      txnId: "TRACE7",
      payerName: "Bob",
      note: "bob-jbm20261006-m007",
      steps: [
        { stage: "dkim", label: "Venmo 签名验证", status: "passed" },
        { stage: "bill_name", label: "名字与账单编号一致性", status: "failed", actual: "bob", expected: "alice" },
        { stage: "manual_review", label: "转入待确认", status: "warning", detail: "备注里的名字和编号不是同一个人" },
      ],
    },
  ];
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
        open: [],
        done: [],
        ignored: [],
        deleted: [],
        payments: [],
        refunds: [],
      },
    }),
  );
  await page.route("**/api/admin/test-token/payment-diagnostics", (route) => {
    if (route.request().method() === "POST") {
      enabled = route.request().postDataJSON().enabled;
      changes.push(enabled);
      return route.fulfill({ json: { enabled } });
    }
    return route.fulfill({ json: { enabled, records: changes.length ? records : [], nextBefore: null } });
  });
  await page.goto("/admin/test-token");
  await page.getByRole("button", { name: "收款", exact: true }).click();
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "付款记录诊断", exact: true }) });
  const toggle = card.getByRole("checkbox", { name: "开启付款记录诊断" });
  await expect(toggle).not.toBeChecked();
  await expect(card).toContainText("14 天");
  await toggle.check();
  await expect(toggle).toBeChecked();
  await card.locator("summary").click();
  await expect(card).toContainText("停在：名字与账单编号一致性");
  await expect(card).toContainText("实际：bob");
  await expect(card).toContainText("期望：alice");
  await expect(card).toContainText("交易 TRACE7");
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(card).toContainText("TRACE7");
  expect(changes).toEqual([true, false]);
});
