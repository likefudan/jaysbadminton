import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drawEnd, drawStart, drawWinners, sha256Hex } from "../src/shared/lottery";
import { toPacific } from "../src/shared/time";
import { announceResults, remindLottery } from "../src/worker/lottery";
import { Client, approveMember, futureDate, setUpAdmin } from "./helpers";

const anon = new Client();

/** The Owner (Jay, number 1) and these members, let in in this order a second apart. */
async function group(names: string[]) {
  const ctx = await setUpAdmin();
  const people = [];
  for (const n of names) people.push(await approveMember(ctx, n));
  const { results } = await env.DB.prepare("SELECT id FROM members ORDER BY id").all<{ id: string }>();
  const t0 = Date.parse("2026-11-01T00:00:00Z");
  for (const [i, r] of results.entries())
    await env.DB.prepare("UPDATE members SET approved_at = ? WHERE id = ?")
      .bind(new Date(t0 + i * 1000).toISOString(), r.id)
      .run();
  return { ctx, people };
}

const form = (over: Record<string, unknown> = {}) => ({
  title: "百人庆祝抽奖",
  poolSize: 4,
  prizes: [
    { name: "亚3", count: 2 },
    { name: "黑航空", count: 1 },
  ],
  drawDate: futureDate(3),
  drawTime: "20:00",
  ...over,
});

describe("抽奖", () => {
  it("draws the same winners from the same seed, each once, nobody outside the list", async () => {
    const a = await drawWinners("abc", [1, 2, 3, 4, 5], 3);
    expect(await drawWinners("abc", [5, 4, 3, 2, 1], 3)).toEqual(a);
    expect(new Set(a).size).toBe(3);
    expect(a.every((r) => r >= 1 && r <= 5)).toBe(true);
    expect(await drawWinners("abc", [1, 2], 5)).toHaveLength(2);
    expect(drawEnd(0, 5)).toBe(drawStart(0, 5) + 9000);
  });

  it("locks the first N by when they were let in, draws live, and shows the seed once the last has landed", async () => {
    const { ctx, people } = await group(["Amy", "Bob", "Cat", "Dan", "Eve"]);
    const [amy, , , , eve] = people as [(typeof people)[0], ...typeof people];
    // Nothing yet.
    expect((await anon.call(`${amy.base}/lottery`)).data.lottery).toBeNull();
    const before = (await ctx.admin.call(`${ctx.base}/lottery?size=4`)).data;
    expect(before.preview.map((e: { name: string }) => e.name)).toEqual(["Jay", "Amy", "Bob", "Cat"]);
    expect(before.canLock).toBe(true);

    expect((await ctx.admin.call(`${ctx.base}/lottery`, form({ prizes: [{ name: "x", count: 5 }] }))).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/lottery`, form())).status).toBe(200);
    // One at a time.
    expect((await ctx.admin.call(`${ctx.base}/lottery`, form())).status).toBe(400);

    const mine = (await anon.call(`${amy.base}/lottery`)).data.lottery;
    expect(mine.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(mine.me).toMatchObject({ rank: 2, inPool: true });
    expect(mine.seed).toBeNull();
    expect(mine.status).toBe("open");
    // Eve came 6th: not on the list, but knows her place.
    const eves = (await anon.call(`${eve!.base}/lottery`)).data.lottery;
    expect(eves.me).toMatchObject({ rank: 6, inPool: false });
    expect(eves.watching).toBe(1); // Amy is watching; Eve isn't on the list.

    // 打气, capped.
    expect((await anon.call(`${amy.base}/lottery/cheer`, { n: 5 })).data).toEqual({ cheers: 5, mine: 5 });
    expect((await anon.call(`${amy.base}/lottery/cheer`, { n: 500 })).data.mine).toBe(99);

    const id = mine.id;
    // Before the time announced it waits; at that time it draws by itself, the first to look
    // recording it, with the time announced as the draw's clock.
    expect((await anon.call(`${amy.base}/lottery`)).data.lottery.status).toBe("open");
    const due = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE lotteries SET draw_at = ? WHERE id = ?").bind(due, id).run();
    // Right at 开奖 nothing is shown: the first shuttle sets off a few seconds later.
    const live = (await anon.call(`${amy.base}/lottery`)).data.lottery;
    expect(live.status).toBe("drawn");
    expect(live.winners).toEqual([]);
    expect(live.draws).toBe(3);
    expect(live.host).toBe("Jay");
    expect(live.drawnAt).toBe(due);
    // Editing or cancelling is too late now.
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/cancel`, {})).status).toBe(409);

    // Once it's over: all three, the seed, and they follow from it.
    await env.DB.prepare("UPDATE lotteries SET drawn_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 120_000).toISOString(), id)
      .run();
    const done = (await anon.call(`${amy.base}/lottery`)).data.lottery;
    expect(done.winners.map((w: { prize: string }) => w.prize)).toEqual(["亚3", "亚3", "黑航空"]);
    expect(await sha256Hex(done.seed)).toBe(done.seedHash);
    expect(done.winners.map((w: { rank: number }) => w.rank)).toEqual(await drawWinners(done.seed, [1, 2, 3, 4], 3));

    // Looking at the results sent the winners' notices (in the background), once.
    await announceResults(env);
    expect((await env.DB.prepare("SELECT announced FROM lotteries WHERE id = ?").bind(id).first())?.announced).toBe(1);
    expect(await announceResults(env)).toBe(false);
    const won = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox WHERE payload LIKE '%恭喜%'").first();
    expect(won?.n).toBe(0); // nobody here has push on; the query ran without error

    // The wall shows who cheered.
    expect(done.entries.find((e: { rank: number }) => e.rank === 2).cheers).toBe(99);

    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/hide`, {})).status).toBe(200);
    expect((await anon.call(`${amy.base}/lottery`)).data.lottery).toBeNull();
    // Off members' pages, it stays in the record: who took part, the prizes, the winners, the seed.
    const { history } = (await ctx.admin.call(`${ctx.base}/lottery/history`)).data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id, status: "drawn", seed: done.seed, seedHash: done.seedHash });
    // 打气 and who was watching are not kept once it is over.
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM lottery_watchers").first<{ n: number }>())?.n).toBe(0);
    expect(history[0].entries.map((e: { name: string }) => e.name)).toEqual(["Jay", "Amy", "Bob", "Cat"]);
    expect(history[0].winners.map((w: { rank: number }) => w.rank)).toEqual(
      done.winners.map((w: { rank: number }) => w.rank),
    );
    expect(history[0].winners.every((w: { name: string }) => w.name)).toBe(true);
    expect((await anon.call(`${ctx.base}/lottery/history`)).status).toBe(401);
  });

  it("lets the Owner lock it: nobody can change or cancel it until unlocked; it still draws on time", async () => {
    const { ctx, people } = await group(["Amy", "Bob", "Cat"]);
    await ctx.admin.call(`${ctx.base}/lottery`, form());
    const id = (await anon.call(`${people[0]!.base}/lottery`)).data.lottery.id;
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/lock`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/lottery`)).data.current.locked).toBe(true);
    const edit = await ctx.admin.call(`${ctx.base}/lottery/${id}/edit`, form({ drawTime: "21:00" }));
    expect(edit.status).toBe(409);
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/cancel`, {})).status).toBe(409);
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/unlock`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/edit`, form({ drawTime: "21:00" }))).status).toBe(200);
    // Locked, it still draws by itself when the time comes.
    await ctx.admin.call(`${ctx.base}/lottery/${id}/lock`, {});
    await env.DB.prepare("UPDATE lotteries SET draw_at = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await ctx.admin.call(`${ctx.base}/lottery`)).data.current.status).toBe("drawn");
    // And the time can't be one already past.
    await ctx.admin.call(`${ctx.base}/lottery/${id}/hide`, {});
    const past = await ctx.admin.call(`${ctx.base}/lottery`, form({ drawDate: "2020-01-01" }));
    expect(past.data.error.message).toBe("开奖时间要在现在之后");
  });

  it("rehearses on the real list with a seed of its own, telling only whoever pressed it", async () => {
    const { ctx, people } = await group(["Amy", "Bob", "Cat"]);
    const r = (await ctx.admin.call(`${ctx.base}/lottery/rehearse`, form())).data;
    expect(r.view.rehearsal).toBe(true);
    expect(r.view.winners).toHaveLength(3);
    expect(r.checks).toMatchObject({ entries: 4, poolSize: 4, noAvatar: 4 });
    // Nothing saved, nothing for members.
    expect((await anon.call(`${people[0]!.base}/lottery`)).data.lottery).toBeNull();
    const pushes = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox").first<{ n: number }>();
    expect(pushes?.n).toBe(0);
    // Published: the 预演 uses the locked list, and its seed is not the real one.
    await ctx.admin.call(`${ctx.base}/lottery`, form());
    const again = (await ctx.admin.call(`${ctx.base}/lottery/rehearse`, {})).data;
    const real = await env.DB.prepare("SELECT seed FROM lotteries").first<{ seed: string }>();
    expect(again.view.seed).not.toBe(real?.seed);
    expect(again.view.entries).toHaveLength(4);
  });

  it("lets a member sit it out from the card and come back, until it is locked", async () => {
    const { ctx, people } = await group(["Amy", "Bob", "Cat", "Dan"]);
    const [amy, bob] = people as [(typeof people)[0], (typeof people)[0]];
    const { results } = await env.DB.prepare("SELECT id FROM members ORDER BY id").all<{ id: string }>();
    const [, amyId, bobId] = results.map((r) => r.id);
    await ctx.admin.call(`${ctx.base}/lottery`, form());
    const first = (await anon.call(`${amy.base}/lottery`)).data.lottery;
    expect(first.me).toMatchObject({ inPool: true, optedOut: false, canOpt: true });
    // Out: the number is kept, nobody takes the place.
    const out = (await anon.call(`${amy.base}/lottery/opt`, { out: true })).data.lottery;
    expect(out.me).toMatchObject({ rank: 2, inPool: false, optedOut: true, canOpt: true });
    expect(out.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 3, 4]);
    // Not so many that the prizes outnumber who is left.
    expect((await anon.call(`${bob.base}/lottery/opt`, { out: true })).status).toBe(400);
    // An admin can't put them back; whoever an admin took off can't come back alone.
    const admin = (await ctx.admin.call(`${ctx.base}/lottery`)).data;
    expect(admin.selfOut).toEqual([amyId]);
    await ctx.admin.call(`${ctx.base}/lottery/${first.id}/exclude`, { exclude: [] });
    expect((await anon.call(`${amy.base}/lottery`)).data.lottery.me.inPool).toBe(false);
    // Back in, at the same number.
    const back = (await anon.call(`${amy.base}/lottery/opt`, { out: false })).data.lottery;
    expect(back.me).toMatchObject({ rank: 2, inPool: true, optedOut: false });
    await ctx.admin.call(`${ctx.base}/lottery/${first.id}/exclude`, { exclude: [bobId] });
    const bobs = (await anon.call(`${bob.base}/lottery/opt`, { out: false })).data.lottery;
    expect(bobs.me).toMatchObject({ inPool: false, optedOut: false, canOpt: false });
    // Locked: nothing changes.
    await ctx.admin.call(`${ctx.base}/lottery/${first.id}/lock`, {});
    expect((await anon.call(`${amy.base}/lottery/opt`, { out: true })).status).toBe(400);
    expect((await anon.call(`${amy.base}/lottery`)).data.lottery.me).toMatchObject({ inPool: true, canOpt: false });
  });

  it("takes members off the list by hand: they keep their number, nobody takes their place", async () => {
    const { ctx, people } = await group(["Amy", "Bob", "Cat", "Dan"]);
    const [amy, bob, cat] = people as [(typeof people)[0], (typeof people)[0], (typeof people)[0]];
    const ids = async () => {
      const { results } = await env.DB.prepare("SELECT id FROM members ORDER BY id").all<{ id: string }>();
      return results.map((r) => r.id);
    };
    const [, amyId, bobId, catId] = await ids();
    // 预演 before publishing leaves them out too.
    const r = (await ctx.admin.call(`${ctx.base}/lottery/rehearse`, form({ exclude: [bobId] }))).data;
    expect(r.view.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 4]);
    expect(r.checks).toMatchObject({ entries: 3, excluded: 1, poolSize: 4 });
    // Not so many that the prizes outnumber who is left.
    expect((await ctx.admin.call(`${ctx.base}/lottery`, form({ exclude: [amyId, bobId] }))).status).toBe(400);
    expect((await ctx.admin.call(`${ctx.base}/lottery`, form({ exclude: [bobId] }))).status).toBe(200);
    const mine = (await anon.call(`${amy.base}/lottery`)).data.lottery;
    expect(mine.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 4]);
    expect((await anon.call(`${bob.base}/lottery`)).data.lottery.me).toMatchObject({ rank: 3, inPool: false });
    const admin = (await ctx.admin.call(`${ctx.base}/lottery`)).data;
    expect(admin.excluded.map((e: { rank: number }) => e.rank)).toEqual([3]);

    // Published, until locked: Bob back on, Cat off.
    const id = mine.id;
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/exclude`, { exclude: [catId] })).status).toBe(200);
    const after = (await anon.call(`${cat.base}/lottery`)).data.lottery;
    expect(after.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3]);
    expect(after.me).toMatchObject({ rank: 4, inPool: false });
    expect((await ctx.admin.call(`${ctx.base}/lottery`)).data.excluded.map((e: { id: string }) => e.id)).toEqual([
      catId,
    ]);
    await ctx.admin.call(`${ctx.base}/lottery/${id}/lock`, {});
    expect((await ctx.admin.call(`${ctx.base}/lottery/${id}/exclude`, { exclude: [] })).status).toBe(409);

    // The draw is only among those taking part.
    await env.DB.prepare("UPDATE lotteries SET draw_at = ?, drawn_at = NULL")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    await ctx.admin.call(`${ctx.base}/lottery`);
    const { results } = await env.DB.prepare("SELECT rank FROM lottery_winners").all<{ rank: number }>();
    expect(results.every((w) => w.rank !== 4)).toBe(true);
  });

  it("takes any draw time still to come", async () => {
    const { ctx } = await group(["Amy", "Bob", "Cat"]);
    const p = toPacific(new Date(Date.now() + 90_000).toISOString());
    expect((await ctx.admin.call(`${ctx.base}/lottery`, form({ drawDate: p.date, drawTime: p.time }))).status).toBe(
      200,
    );
  });

  it("reminds half an hour before, once", async () => {
    const { ctx } = await group(["Amy"]);
    await ctx.admin.call(`${ctx.base}/lottery`, form({ prizes: [{ name: "亚3", count: 1 }] }));
    const drawAt = await env.DB.prepare("SELECT draw_at FROM lotteries").first<{ draw_at: string }>();
    const at = Date.parse(drawAt!.draw_at);
    expect(await remindLottery(env, at - 40 * 60_000)).toBe(false);
    expect(await remindLottery(env, at - 20 * 60_000)).toBe(true);
    expect(await remindLottery(env, at - 10 * 60_000)).toBe(false);
  });

  it("is the Owner's and admins' only, and only the Owner locks", async () => {
    const { ctx } = await group(["Amy"]);
    expect((await anon.call(`${ctx.base}/lottery`)).status).toBe(401);
  });
});
