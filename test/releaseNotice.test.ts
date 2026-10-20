import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setChatLang } from "../src/worker/botLang";
import { sendReleaseNotices } from "../src/worker/releaseNotice";
import { appoint, approveMember, ORIGIN, setUpAdmin } from "./helpers";

/** 正式版发布通知: the Owner and the admins hear in Telegram what a production release changed. */

const KEYED = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1", ANTHROPIC_API_KEY: "test-key" };

let sent: { chat: string; text: string }[] = [];
let asked: any[] = [];
let answer: object | null = null;
beforeEach(() => {
  sent = [];
  asked = [];
  answer = {
    simplified: ["活动卡片上能看到预定的场地号"],
    traditional: ["活動卡片上能看到預定的場地號"],
    english: ["Event cards show the booked court numbers"],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.anthropic.com/")) {
      asked.push(JSON.parse(String(init?.body ?? (input as Request).body)));
      if (!answer) return Response.json({ type: "error", error: { type: "overloaded_error" } }, { status: 529 });
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 500, output_tokens: 100 },
      });
    }
    if (!url.startsWith("https://api.telegram.org/bottest-bot-token/")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/sendMessage")) sent.push({ chat: String(body.chat_id), text: body.text });
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
});
afterEach(() => vi.restoreAllMocks());

const record = (tag: string, changes: string[], at = new Date().toISOString()) =>
  env.DB.prepare("INSERT INTO release_notices (tag, changes, created_at) VALUES (?, ?, ?)")
    .bind(tag, JSON.stringify(changes), at)
    .run();
const to = (chat: string) => sent.filter((s) => s.chat === chat).map((s) => s.text);

/** Owner Jay (chat 42), admin Carol (77, English), organizer Alice (99). */
async function scenario() {
  const ctx = await setUpAdmin();
  const carol = await approveMember(ctx, "Carol");
  const alice = await approveMember(ctx, "Alice");
  await appoint(carol.id, "carol", "admin");
  await appoint(alice.id, "alice");
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
  for (const [id, chat] of [
    [carol.id, "77"],
    [alice.id, "99"],
  ])
    await env.DB.prepare("INSERT INTO telegram_bindings (member_id, chat_id, chat_name) VALUES (?, ?, 'TG')")
      .bind(id, chat)
      .run();
  await setChatLang(env, "77", "en");
  sent = [];
}

describe("正式版发布通知", () => {
  it("tells the Owner and each admin, in their own language, once", async () => {
    await scenario();
    await record("v2026.10.21", ["预定场地：负责人填场地编号，报名的人在卡片上看到"]);
    expect(await sendReleaseNotices(KEYED)).toBe(1);
    expect(to("42")).toEqual([
      `🚀 新版本 v2026.10.21 已发布到正式网站\n\n这次的更新：\n• 活动卡片上能看到预定的场地号\n\n${ORIGIN}`,
    ]);
    expect(to("77")).toEqual([
      `🚀 Version v2026.10.21 is now live\n\nWhat's new:\n• Event cards show the booked court numbers\n\n${ORIGIN}`,
    ]);
    expect(to("99")).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0].messages[0].content).toContain("预定场地：负责人填场地编号");

    sent = [];
    expect(await sendReleaseNotices(KEYED)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("is sent once when CI's call and the cron run together", async () => {
    await scenario();
    await record("v2026.10.21", ["改动"]);
    const counts = await Promise.all([sendReleaseNotices(KEYED), sendReleaseNotices(KEYED)]);
    expect(counts.sort()).toEqual([0, 1]);
    expect(to("42")).toHaveLength(1);
  });

  it("lists the titles themselves when Claude can't help, and leaves admins out while the flag is off", async () => {
    await scenario();
    answer = null;
    await record("v2026.10.21", ["分享名片弹窗：去掉标题", "卡片状态字体再大一点"]);
    expect(await sendReleaseNotices({ ...KEYED, ORGANIZERS: "0" })).toBe(1);
    expect(to("42")[0]).toContain("• 分享名片弹窗：去掉标题\n• 卡片状态字体再大一点");
    expect(to("77")).toEqual([]);
  });

  it("says there is nothing to notice when Claude finds only internal changes", async () => {
    await scenario();
    answer = { simplified: [], traditional: [], english: [] };
    await record("v2026.10.21", ["CI：测试并行运行"]);
    await sendReleaseNotices(KEYED);
    expect(to("42")[0]).toContain("这次没有大家能看到的变化，只是内部改进。");
    expect(to("77")[0]).toContain("Nothing you'll notice this time");
  });

  it("drops a notice that sat unsent for days instead of announcing it late", async () => {
    await scenario();
    await record("v2026.10.01", ["旧的"], new Date(Date.now() - 3 * 24 * 3600_000).toISOString());
    expect(await sendReleaseNotices(KEYED)).toBe(0);
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT sent_at FROM release_notices").first<{ sent_at: string | null }>();
    expect(row?.sent_at).not.toBeNull();
  });

  it("is sent by POST /api/release-notice, which takes nothing and sends only what CI recorded", async () => {
    await scenario();
    let res = await exports.default.fetch(`${ORIGIN}/api/release-notice`, { method: "POST" });
    expect(await res.json()).toEqual({ sent: 0 });
    await record("v2026.10.21", ["改动"]);
    res = await exports.default.fetch(`${ORIGIN}/api/release-notice`, { method: "POST" });
    expect(await res.json()).toEqual({ sent: 1 });
    expect(to("42")).toHaveLength(1);
  });
});
