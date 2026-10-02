import { test, expect } from "@playwright/test";

test("the admin reviews application details, sees email failure and retries without approving again", async ({ page }) => {
  let approved = false, emailStatus = "failed";
  const member = { id: "M999", username: "Alice", wechatNickname: "Alice", applicantName: "Alice 身份", wechatAccount: "alice_wechat", googleEmail: "alice@gmail.com", hasLink: false, isOwner: false, adminNote: "", owingCents: 0 };
  await page.route("**/api/auth/session", route => route.fulfill({ json: { signedIn: false } }));
  await page.route("**/api/admin/test-token/members", route => route.fulfill({ json: { pending: approved ? [] : [member], active: approved ? [{ ...member, approvalEmailStatus: emailStatus }] : [], inactive: [], deleted: [] } }));
  await page.route("**/api/admin/test-token/members/M999/approve", route => {
    approved = true;
    return route.fulfill({ json: { link: null, googleEmail: member.googleEmail, emailStatus } });
  });
  await page.route("**/api/admin/test-token/members/M999/approval-email", route => {
    emailStatus = "sent";
    return route.fulfill({ json: { emailStatus } });
  });
  await page.goto("/admin/test-token?tab=pending");
  await expect(page.getByText(/身份：Alice 身份/)).toBeVisible();
  await expect(page.getByText(/微信：alice_wechat/)).toBeVisible();
  await page.getByRole("button", { name: "通过", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("邮件发送失败");
  await page.getByRole("button", { name: "成员", exact: true }).click();
  await page.getByRole("button", { name: "重试审核邮件" }).click();
  await expect(page.getByRole("status")).toContainText("审核通知已发送");
  await expect(page.getByRole("button", { name: "重试审核邮件" })).toHaveCount(0);
});
