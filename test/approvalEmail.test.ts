import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMember } from "../src/worker/members";
import { sendApprovalEmail, sendApplicationNotice } from "../src/worker/approvalEmail";
import { Client, googleJoin, linkMember, setUpAdmin, tokenOf } from "./helpers";

const bindings = () => ({
  ...env,
  RESEND_API_KEY: "test-email-key",
  EMAIL_FROM: "Badminton <members@example.com>",
  SITE_ORIGIN: "https://badminton.test",
});
const member = (status: "active" | "pending" = "active", message?: string) =>
  createMember(env, {
    username: "Alice",
    wechatNickname: "Alice微信",
    message,
    status,
    googleSub: "alice",
    googleEmail: "alice@gmail.com",
  });
afterEach(() => vi.restoreAllMocks());

it("sends an approval email to the verified Google address with a normal login link and deduplicates retries", async () => {
  const m = await member();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "email1" }));
  expect(await sendApprovalEmail(bindings(), m.id)).toBe("sent");
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(init?.headers).toMatchObject({ "Idempotency-Key": `member-approval/${m.id}/${m.approved_at}` });
  expect(JSON.parse(String(init?.body))).toMatchObject({
    to: ["alice@gmail.com"],
    text: expect.stringContaining("https://badminton.test/login"),
  });
  expect(String(init?.body)).not.toContain("/m/");
  expect(await sendApprovalEmail(bindings(), m.id)).toBe("sent");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps approval effective on provider failure and allows retry with the same idempotency key", async () => {
  const m = await member();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ id: "email2" }));
  expect(await sendApprovalEmail(bindings(), m.id)).toBe("failed");
  expect(
    await env.DB.prepare("SELECT status, approval_email_status FROM members WHERE id = ?").bind(m.id).first(),
  ).toMatchObject({ status: "active", approval_email_status: "failed" });
  expect(await sendApprovalEmail(bindings(), m.id)).toBe("sent");
  expect(fetchMock.mock.calls[0]![1]?.headers).toEqual(fetchMock.mock.calls[1]![1]?.headers);
});

it("reports missing email configuration and does not email pending applicants", async () => {
  const m = await member("pending");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  expect(await sendApprovalEmail(bindings(), m.id)).toBe("not_needed");
  await env.DB.prepare("UPDATE members SET status = 'active', approved_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), m.id)
    .run();
  expect(await sendApprovalEmail({ ...bindings(), RESEND_API_KEY: undefined }, m.id)).toBe("not_configured");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("notifies the bound administrator of the username, WeChat name, Google email and note", async () => {
  const m = await member("pending", "小明介绍的");
  await env.DB.prepare("INSERT INTO settings (key,value) VALUES ('telegram_chat_id','owner-chat')").run();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
  expect(await sendApplicationNotice({ ...bindings(), TELEGRAM_BOT_TOKEN: "test-bot" }, m)).toBe(true);
  const message = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
  expect(message.chat_id).toBe("owner-chat");
  expect(message.text).toContain("用户名：Alice");
  expect(message.text).toContain("微信名：Alice微信");
  expect(message.text).toContain("Google 邮箱：alice@gmail.com");
  expect(message.text).toContain("留言：小明介绍的");
});

describe("用邮箱注册 (members from before 2026-11-04)", () => {
  const sentTo = (fetchMock: { mock: { calls: unknown[][] } }) =>
    fetchMock.mock.calls.map(
      (c) => JSON.parse(String((c[1] as RequestInit).body)) as { to: string[]; subject: string; text: string },
    );

  it("one person per email: the address of an old link member can't be used again", async () => {
    await linkMember("Alice", "Alice微信", "alice@example.com");
    expect((await linkMember("Bob", "Bob", "nope").catch((e) => e)).status).toBe(400);
    const again = await googleJoin("Alice2", "a", { email: "ALICE@example.com" });
    expect(again.status).toBe(409);
  });

  it("approving an old email applicant mails them their own link and shows the admin the address", async () => {
    const ctx = await setUpAdmin();
    const body = { email: "alice@example.com" };
    const joined = await linkMember("Alice", "Alice微信", body.email);
    const { data: pending } = await ctx.admin.call(`${ctx.base}/members`);
    expect(pending.pending.find((m: { id: string }) => m.id === joined.id).email).toBe(body.email);
    // The test worker has no Resend key: approval still works and says so.
    const { data } = await ctx.admin.call(`${ctx.base}/members/${joined.id}/approve`, {});
    expect(data).toMatchObject({ email: body.email, emailStatus: "not_configured", googleEmail: null });
    expect(data.link).toContain("/m/");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "e" }));
    expect(await sendApprovalEmail(bindings(), joined.id)).toBe("sent");
    const [mail] = sentTo(fetchMock);
    expect(mail).toMatchObject({ to: [body.email], subject: "你的羽毛球群专属链接" });
    expect(mail!.text).toContain(`https://badminton.test/m/${tokenOf(data.link)}`);
    expect(mail!.text).toContain("垃圾邮件");
  });

  it("找回专属链接 is off: nothing is mailed, whoever asks (Ke Li 2026-11-04)", async () => {
    await setUpAdmin();
    await linkMember("Alice", "Alice", "alice@example.com");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await new Client().call("/api/public/recover-link", { email: "alice@example.com" });
    expect(res.status).toBe(410);
    expect(res.data.error.message).toBe("专属链接已停止找回，请用 Google 登录");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
