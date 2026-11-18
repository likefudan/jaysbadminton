import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkFriendName, checkNameChars, checkUsername } from "../src/shared/rules";
import { Client, approveMember, createTestEvent, googleJoin, setUpAdmin } from "./helpers";

const anon = new Client();
const ONLY = "名字只能用中文、英文、数字和 . - _ ( )";
const START = "名字要以中文、英文或数字开头";

describe("what a name may be made of (Ke Li 2026-11-18)", () => {
  it("takes 中文 (简/繁), letters, digits, spaces and . - _ ( )", () => {
    for (const ok of ["Jay", "小王", "張偉", "Jay.L", "小王(新)", "小王（新）", "a_b-c", "Tom Lee", "2号"])
      expect(checkNameChars(ok), ok).toBeNull();
  });

  it("turns down emoji, fancy letters and other symbols", () => {
    for (const bad of ["Jay🏸", "🏸", "小王❤️", "𝓙𝓪𝔂", "Ｊａｙ", "a@b", "a·b", "★星", "a‍b"])
      expect(checkNameChars(bad), bad).toBe(ONLY);
  });

  it("must start with 中文, a letter or a digit, so names of only symbols fail", () => {
    for (const bad of ["...", "--", "(_)", ".Jay", "(新)小王"]) expect(checkNameChars(bad), bad).toBe(START);
  });

  it("is part of the username check, and blank friend names stay fine", () => {
    expect(checkUsername("Jay🏸")).toBe(ONLY);
    expect(checkUsername("Tom Lee")).toBe("用户名不能包含空格");
    expect(checkFriendName("  ")).toBeNull();
    expect(checkFriendName(" ... ")).toBe(START);
  });
});

describe("names on the server", () => {
  it("turns down a new member's username with an emoji", async () => {
    const res = await googleJoin("Jay🏸", "jay");
    expect(res.status).toBe(400);
    expect(res.data.error.message).toBe(ONLY);
    // 微信名 is copied from WeChat, where emoji are common: left alone.
    expect((await googleJoin("Jay", "杰🏸")).status).toBe(200);
  });

  it("checks a rename, but an old name with an emoji may be saved unchanged", async () => {
    const ctx = await setUpAdmin();
    const dan = await approveMember(ctx, "Dan");
    await env.DB.prepare("UPDATE members SET username = 'Dan🏸' WHERE id = ?").bind(dan.id).run();
    expect((await anon.call(`${dan.base}/rename`, { username: "Dan🏸" })).status).toBe(200);
    const bad = await anon.call(`${dan.base}/rename`, { username: "..." });
    expect(bad.status).toBe(400);
    expect(bad.data.error.message).toBe(START);
    expect((await anon.call(`${dan.base}/rename`, { username: "Dan.L" })).status).toBe(200);
    expect((await anon.call(`${dan.base}/me`)).data.username).toBe("Dan.L");
  });

  it("checks new friends' names on sign-up, keeping the ones already saved", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const dan = await approveMember(ctx, "Dan");
    const bad = await anon.call(`${dan.base}/events/${e.id}/signup`, { friends: ["Tom🏸"] });
    expect(bad.status).toBe(400);
    expect(bad.data.error.message).toBe(ONLY);
    expect((await anon.call(`${dan.base}/events/${e.id}/signup`, { friends: ["Tom", ""] })).status).toBe(200);
    // A name saved before the rule came in.
    await env.DB.prepare("UPDATE registrations SET friend_name = '猫🐱' WHERE event_id = ? AND friend_index = 1")
      .bind(e.id)
      .run();
    expect((await anon.call(`${dan.base}/events/${e.id}/signup`, { friends: ["猫🐱", "小李"] })).status).toBe(200);
    expect((await anon.call(`${dan.base}/events/${e.id}/signup`, { friends: ["猫🐱", "--"] })).status).toBe(400);
  });

  it("checks names the Owner adds or renames on the roster", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const dan = await approveMember(ctx, "Dan");
    const add = (friends: string[]) =>
      ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: dan.id, friends });
    expect((await add(["🏸"])).data.error.message).toBe(ONLY);
    const d = (await add(["Amy"])).data;
    const row = d.roster.find((r: { friendIndex: number }) => r.friendIndex === 1);
    const rename = (name: string) => ctx.admin.call(`${ctx.base}/events/${e.id}/roster/${row.id}/rename`, { name });
    expect((await rename("(_)")).data.error.message).toBe(START);
    expect((await rename("Amy(新)")).status).toBe(200);
    await env.DB.prepare("UPDATE registrations SET friend_name = 'Amy✨' WHERE id = ?").bind(row.id).run();
    expect((await rename("Amy✨")).status).toBe(200);
  });
});
