import { test, expect } from "@playwright/test";

test("the admin reviews application details, sees email failure and retries without approving again", async ({ page }) => {
  let approved = false, emailStatus = "failed";
  const member = { id: "M999", username: "Alice", wechatNickname: "alice_wx", applicationMessage: "小明介绍的", googleEmail: "alice@gmail.com", hasLink: false, isOwner: false, adminNote: "", owingCents: 0 };
  // Applied before the form was simplified: still shows what they filled in then.
  const older = { id: "M998", username: "Bob", wechatNickname: "Bob 身份", applicantName: "Bob 身份", wechatAccount: "bob_wechat", applicationMessage: "", googleEmail: "bob@gmail.com", hasLink: false, isOwner: false, adminNote: "", owingCents: 0 };
  await page.route("**/api/auth/session", route => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", route => route.fulfill({ json: { pending: approved ? [older] : [member, older], active: approved ? [{ ...member, approvalEmailStatus: emailStatus }] : [], inactive: [], deleted: [] } }));
  await page.route("**/api/admin/test-token/members/M999/approve", route => {
    approved = true;
    return route.fulfill({ json: { link: null, googleEmail: member.googleEmail, emailStatus } });
  });
  await page.route("**/api/admin/test-token/members/M999/approval-email", route => {
    emailStatus = "sent";
    return route.fulfill({ json: { emailStatus } });
  });
  await page.goto("/admin/test-token?tab=pending");
  const alice = page.locator(".row", { hasText: "Alice" });
  await expect(alice).toContainText("微信：alice_wx");
  await expect(alice).toContainText("留言：小明介绍的");
  await expect(page.locator(".row", { hasText: "Bob" })).toContainText("微信：bob_wechat · 身份：Bob 身份");
  await alice.getByRole("button", { name: "通过", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("邮件发送失败");
  await page.getByRole("button", { name: "成员", exact: true }).click();
  await page.getByRole("button", { name: "重试审核邮件" }).click();
  await expect(page.getByRole("status")).toContainText("审核通知已发送");
  await expect(page.getByRole("button", { name: "重试审核邮件" })).toHaveCount(0);
});
