import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkGames } from "../src/shared/rules";
import { toPacific } from "../src/shared/time";
import { eraseMember } from "../src/worker/erase";
import { getMember } from "../src/worker/members";
import { matchStatus, scoreOpen } from "../src/worker/scores";
import { approveMember, Client, createTestEvent, setUpAdmin } from "./helpers";

const anon = new Client();
const today = toPacific(new Date()).date;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** An event that ended `endedAgo` ms ago, with these members on it. */
async function played(names: string[], endedAgo = HOUR) {
  const ctx = await setUpAdmin();
  const people = [];
  for (const n of names) people.push(await approveMember(ctx, n));
  const e = await createTestEvent(ctx);
  for (const p of people) await anon.call(`${p.base}/events/${e.id}/signup`, { friends: [] });
  const end = Date.now() - endedAgo;
  await env.DB.prepare("UPDATE events SET status = 'closed', date = ?, start_at = ?, end_at = ? WHERE id = ?")
    .bind(today, new Date(end - 2 * HOUR).toISOString(), new Date(end).toISOString(), e.id)
    .run();
  return { ctx, e, people };
}

const card = async (base: string, id: number) => (await anon.call(`${base}/events/${id}`)).data.event;

describe("比分", () => {
  it("may be recorded from the start until 3 days after the end, never on a cancelled event", () => {
    const e = { status: "closed" as const, start_at: "2026-11-01T03:00:00Z", end_at: "2026-11-01T05:00:00Z" };
    expect(scoreOpen(e, new Date("2026-11-01T02:59:59Z"))).toBe(false);
    expect(scoreOpen(e, new Date("2026-11-01T03:00:00Z"))).toBe(true);
    expect(scoreOpen(e, new Date("2026-11-04T05:00:00Z"))).toBe(true);
    expect(scoreOpen(e, new Date("2026-11-04T05:00:01Z"))).toBe(false);
    expect(scoreOpen({ ...e, status: "cancelled" }, new Date("2026-11-01T04:00:00Z"))).toBe(false);
  });

  it("counts once every member confirms, is void on one no, lapses after 3 days", () => {
    const at = new Date("2026-11-10T00:00:00Z");
    const fresh = "2026-11-09T00:00:00Z";
    expect(matchStatus(["ok", "ok"], fresh, at)).toBe("confirmed");
    expect(matchStatus(["ok", null], fresh, at)).toBe("pending");
    expect(matchStatus(["ok", null, "no"], fresh, at)).toBe("rejected");
    expect(matchStatus(["ok", null], "2026-11-06T23:59:59Z", at)).toBe("expired");
    // Confirmed in time stays confirmed.
    expect(matchStatus(["ok", "ok"], "2026-11-01T00:00:00Z", at)).toBe("confirmed");
  });

  it("checks the games: 1 to 3, 0–99, no draws", () => {
    expect(checkGames([[21, 18]])).toEqual([[21, 18]]);
    expect(checkGames([])).toBe("请填 1 到 3 局比分");
    expect(
      checkGames([
        [21, 1],
        [1, 21],
        [21, 2],
        [2, 21],
      ]),
    ).toBe("请填 1 到 3 局比分");
    expect(checkGames([[21, 21]])).toBe("一局比分不能打平");
    expect(checkGames([[100, 2]])).toBe("比分要是 0 到 99 的整数");
    expect(checkGames([[21.5, 2]])).toBe("比分要是 0 到 99 的整数");
  });

  it("needs every other member on court to confirm, and shows it to everyone on the list only then", async () => {
    const { e, people } = await played(["Amy", "Bob", "Cat", "Dan", "Eve"]);
    const [amy, bob, cat, dan, eve] = people as [(typeof people)[0], ...typeof people];

    const picks = (await anon.call(`${amy.base}/events/${e.id}/scores/people`)).data;
    expect(picks.people.map((p: { name: string }) => p.name)).toEqual(["Bob", "Cat", "Dan", "Eve"]);

    // The other side must have a member.
    const allGuests = await anon.call(`${amy.base}/events/${e.id}/scores`, {
      doubles: true,
      partner: { id: bob!.id },
      opponents: [{ guest: "阿杰" }, { guest: "" }],
      games: [[21, 9]],
    });
    expect(allGuests.data.error.message).toBe("对方至少要有一位群友");

    const rec = await anon.call(`${amy.base}/events/${e.id}/scores`, {
      doubles: true,
      partner: { id: bob!.id },
      opponents: [{ id: cat!.id }, { guest: " 阿杰 " }],
      games: [
        [21, 18],
        [19, 21],
        [21, 15],
      ],
    });
    expect(rec.status).toBe(200);
    const id = rec.data.id;

    // Pending: Amy, Bob and Cat see it; Dan (on the list, not on court) doesn't.
    const amyCard = await card(amy.base, e.id);
    expect(amyCard.scores.open).toBe(true);
    expect(amyCard.scores.matches).toHaveLength(1);
    expect(amyCard.scores.matches[0]).toMatchObject({
      status: "pending",
      mine: true,
      toAnswer: false,
      recorder: "Amy",
    });
    expect(amyCard.scores.matches[0].sides[1]).toEqual([
      { id: cat!.id, name: "Cat", answer: null, me: false },
      { id: null, name: "阿杰", answer: null, me: false },
    ]);
    expect((await card(bob!.base, e.id)).scores.matches[0].toAnswer).toBe(true);
    expect((await card(dan!.base, e.id)).scores.matches).toEqual([]);

    // Someone not on court can't answer; the recorder neither.
    expect((await anon.call(`${dan!.base}/events/${e.id}/scores/${id}/answer`, { ok: true })).status).toBe(400);
    expect((await anon.call(`${amy.base}/events/${e.id}/scores/${id}/answer`, { ok: true })).status).toBe(400);

    // Bob, the teammate, confirms: still waiting for Cat.
    await anon.call(`${bob!.base}/events/${e.id}/scores/${id}/answer`, { ok: true });
    expect((await card(amy.base, e.id)).scores.matches[0].status).toBe("pending");
    await anon.call(`${cat!.base}/events/${e.id}/scores/${id}/answer`, { ok: true });
    expect((await card(amy.base, e.id)).scores.matches[0].status).toBe("confirmed");
    // Now everyone on the list sees it, and it can't be deleted.
    expect((await card(dan!.base, e.id)).scores.matches[0].status).toBe("confirmed");
    expect((await anon.call(`${amy.base}/events/${e.id}/scores/${id}/delete`, {})).status).toBe(400);

    // Not someone who isn't on the list.
    expect(
      (
        await anon.call(`${eve!.base}/events/${e.id}/scores`, {
          doubles: false,
          opponents: [{ id: eve!.id }],
          games: [[21, 3]],
        })
      ).data.error.message,
    ).toBe("同一个人不能出现两次");
  });

  it("is void when one says the score is wrong; the recorder can resubmit or delete it", async () => {
    const { ctx, e, people } = await played(["Amy", "Bob"]);
    const [amy, bob] = people as [(typeof people)[0], (typeof people)[0]];
    const singles = (games: number[][], replaces?: number) =>
      anon.call(`${amy.base}/events/${e.id}/scores`, { doubles: false, opponents: [{ id: bob.id }], games, replaces });
    // Bob gets a push to confirm; Amy one when he says it's wrong.
    for (const id of [amy.id, bob.id])
      await env.DB.prepare(
        "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, 'k', 'a', ?)",
      )
        .bind(`https://push.example/${id}`, id, new Date().toISOString())
        .run();
    const pushed = async () =>
      (
        await env.DB.prepare("SELECT member_id, payload FROM push_outbox WHERE kind = 'score' ORDER BY id").all<{
          member_id: string;
          payload: string;
        }>()
      ).results.map((r) => [r.member_id, JSON.parse(r.payload).title]);
    const first = (await singles([[21, 15]])).data.id;
    expect(await pushed()).toEqual([[bob.id, "Amy 记录了一场单打，请确认"]]);
    await anon.call(`${bob.base}/events/${e.id}/scores/${first}/answer`, { ok: false });
    expect((await card(amy.base, e.id)).scores.matches[0].status).toBe("rejected");
    expect((await pushed()).at(-1)).toEqual([amy.id, "Bob 说比分不对"]);
    expect((await card(bob.base, e.id)).scores.matches[0].toAnswer).toBe(false);

    // Resubmitted with the right score: the old one goes.
    const second = (await singles([[15, 21]], first)).data.id;
    const list = (await card(amy.base, e.id)).scores.matches;
    expect(list.map((m: { id: number; status: string }) => [m.id, m.status])).toEqual([[second, "pending"]]);
    // Bob can't delete Amy's; Amy can.
    expect((await anon.call(`${bob.base}/events/${e.id}/scores/${second}/delete`, {})).status).toBe(400);
    expect((await anon.call(`${amy.base}/events/${e.id}/scores/${second}/delete`, {})).status).toBe(200);
    expect((await card(amy.base, e.id)).scores.matches).toEqual([]);

    // Unanswered for more than 3 days: lapsed, and Bob can't confirm it any more.
    const third = (await singles([[21, 3]])).data.id;
    await env.DB.prepare("UPDATE matches SET created_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 3 * DAY - 1000).toISOString(), third)
      .run();
    expect((await card(amy.base, e.id)).scores.matches[0].status).toBe("expired");
    expect((await anon.call(`${bob.base}/events/${e.id}/scores/${third}/answer`, { ok: true })).status).toBe(400);

    // Deleting Bob's account takes the matches he played in with it.
    await eraseMember(env, (await getMember(env, bob.id))!);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM matches").first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM match_players").first<{ n: number }>()).toEqual({ n: 0 });
    void ctx;
  });

  it("only from the start until 3 days after the end, and only for people who played", async () => {
    const { ctx, e, people } = await played(["Amy", "Bob"], -HOUR);
    const [amy, bob] = people as [(typeof people)[0], (typeof people)[0]];
    const rec = () =>
      anon.call(`${amy.base}/events/${e.id}/scores`, { doubles: false, opponents: [{ id: bob.id }], games: [[21, 3]] });
    // Under way: open.
    expect((await card(amy.base, e.id)).scores).toEqual({ open: true, matches: [] });
    expect((await rec()).status).toBe(200);
    await env.DB.prepare("UPDATE events SET end_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 3 * DAY - HOUR).toISOString(), e.id)
      .run();
    expect((await rec()).data.error.message).toBe("活动开始后到结束 3 天内可以记录比分");
    // Closed, but the match stays on the card.
    expect((await card(amy.base, e.id)).scores.open).toBe(false);

    // Not on the list: nothing to record.
    const other = await approveMember(ctx, "Fay");
    expect((await anon.call(`${other.base}/events/${e.id}/scores/people`)).data.error.message).toBe(
      "只有来打球的人可以记录比分",
    );
    // Not someone who isn't on the list as an opponent either.
    await env.DB.prepare("UPDATE events SET end_at = ? WHERE id = ?").bind(new Date().toISOString(), e.id).run();
    const stranger = await anon.call(`${amy.base}/events/${e.id}/scores`, {
      doubles: false,
      opponents: [{ id: other.id }],
      games: [[21, 3]],
    });
    expect(stranger.data.error.message).toBe("只能选这场来打球的人");
  });
});
