import {
  LOTTERY_CHEERS_MAX,
  LOTTERY_POOL_MAX,
  LOTTERY_ONLINE_MS,
  type LotteryAdmin,
  type LotteryEntry,
  type LotteryPrize,
  type LotteryRecord,
  type LotteryRehearsal,
  type LotteryView,
  type LotteryWinner,
  checkLottery,
  drawEnd,
  drawStart,
  drawWinners,
  newSeed,
  prizeSlots,
  sha256Hex,
} from "../shared/lottery";
import { isDate, isTime, pacificToUtc, toPacific } from "../shared/time";
import type { Actor } from "./access";
import { avatarUrl } from "./avatars";
import { type BotLang, bt, botInstant } from "./botLang";
import { now } from "./db";
import type { Env } from "./env";
import { badRequest, HttpError, str } from "./http";
import { message } from "./notify";
import { payeeName } from "./payees";
import type { PushMessage } from "./push";
import { sendToMember, sendToOwnerAndAdmins } from "./telegram";

/**
 * 抽奖 (Ke Li 2026-11-16, 百人庆祝抽奖, option C 百人头像墙): the first N members by when they were
 * let into the group, a few prizes drawn live on a wall of their faces. The Owner and admins set it
 * up in 设置 → 抽奖, can 预演 it (only they see it, nothing goes to anyone else, it counts for
 * nothing; Ke Li: 管理员可以提前进行预演检查错误) and publish it; it draws by itself when the countdown
 * ends.
 *
 * Who takes part: everyone let in, in the order they were let in (approved_at, then member number),
 * the Owner and admins too, and members since stopped too (they keep their place); not someone
 * still waiting for approval or removed. Publishing locks the first N. The Owner and admins can take
 * some of them off by hand (Ke Li 2026-11-16: 允许 opt out 一些人，手动选择), until it is locked or
 * drawn: they keep their number but don't take part, and nobody comes in in their place.
 */

const ELIGIBLE = "status != 'pending' AND deleted_at IS NULL AND approved_at IS NOT NULL";
/** Member numbers as numbers, so M1000 comes after M999. */
const ORDER = "approved_at, CAST(SUBSTR(id, 2) AS INTEGER), id";

export interface LotteryRow {
  id: number;
  title: string;
  pool_size: number;
  prizes: string;
  draw_at: string;
  next_goal: number | null;
  status: "open" | "drawn" | "cancelled";
  seed: string;
  seed_hash: string;
  created_by: string | null;
  created_at: string;
  drawn_at: string | null;
  drawn_by: string | null;
  reminded: number;
  announced: number;
  hidden_at: string | null;
  locked: number;
}

const prizesOf = (l: LotteryRow): LotteryPrize[] => JSON.parse(l.prizes) as LotteryPrize[];

/** The 抽奖 members see: the one published, or drawn and not yet taken off. */
async function shownLottery(env: Env, at = Date.now()): Promise<LotteryRow | null> {
  const l = await env.DB.prepare(
    `SELECT * FROM lotteries WHERE status = 'open' OR (status = 'drawn' AND hidden_at IS NULL)
     ORDER BY id DESC LIMIT 1`,
  ).first<LotteryRow>();
  return l && drawIfDue(env, l, at);
}

/** Each member's place in the order they were let in, from 1. */
async function ranksOf(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT id, ROW_NUMBER() OVER (ORDER BY ${ORDER}) AS rank FROM members WHERE ${ELIGIBLE}`,
  ).all<{ id: string; rank: number }>();
  return new Map(results.map((r) => [r.id, r.rank]));
}

interface PersonRow {
  rank: number;
  id: string;
  username: string;
  avatar: string | null;
  google_picture: string | null;
  seen_at: string | null;
  cheers: number | null;
}

const toEntry = (p: PersonRow, at: number): LotteryEntry => ({
  rank: p.rank,
  id: p.id,
  name: p.username,
  avatar: avatarUrl(p),
  online: !!p.seen_at && at - Date.parse(p.seen_at) < LOTTERY_ONLINE_MS,
  cheers: p.cheers ?? 0,
});

/** The locked list, with who has the page open now. */
async function lockedEntries(env: Env, l: LotteryRow, at: number): Promise<LotteryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.rank, m.id, m.username, m.avatar, m.google_picture, w.seen_at, w.cheers
     FROM lottery_entries e JOIN members m ON m.id = e.member_id
     LEFT JOIN lottery_watchers w ON w.lottery_id = e.lottery_id AND w.member_id = m.id
     WHERE e.lottery_id = ? ORDER BY e.rank`,
  )
    .bind(l.id)
    .all<PersonRow>();
  return results.map((p) => toEntry(p, at));
}

/** The first `size` members as the list would be locked now (设置 → 抽奖 before publishing). */
async function previewEntries(env: Env, size: number): Promise<LotteryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT rank, id, username, avatar, google_picture, NULL AS seen_at, 0 AS cheers FROM (
       SELECT *, ROW_NUMBER() OVER (ORDER BY ${ORDER}) AS rank FROM members WHERE ${ELIGIBLE}
     ) WHERE rank <= ? ORDER BY rank`,
  )
    .bind(size)
    .all<PersonRow>();
  return results.map((p) => toEntry(p, 0));
}

/** Those taken off the list by hand. */
async function excludedEntries(env: Env, l: LotteryRow): Promise<LotteryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT x.rank, m.id, m.username, m.avatar, m.google_picture, NULL AS seen_at, 0 AS cheers
     FROM lottery_excluded x JOIN members m ON m.id = x.member_id WHERE x.lottery_id = ? ORDER BY x.rank`,
  )
    .bind(l.id)
    .all<PersonRow>();
  return results.map((p) => toEntry(p, 0));
}

/** Those who took themselves off the list. */
async function selfOutIds(env: Env, id: number): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT member_id FROM lottery_optouts WHERE lottery_id = ?")
    .bind(id)
    .all<{ member_id: string }>();
  return results.map((r) => r.member_id);
}

async function winnerRows(env: Env, l: LotteryRow): Promise<LotteryWinner[]> {
  const { results } = await env.DB.prepare(
    "SELECT draw_no AS drawNo, rank, prize FROM lottery_winners WHERE lottery_id = ? ORDER BY draw_no",
  )
    .bind(l.id)
    .all<LotteryWinner>();
  return results;
}

const memberCount = async (env: Env) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE ${ELIGIBLE}`).first<{ n: number }>())?.n ?? 0;

/** The page as everyone sees it at `at`: draws whose shuttle has not set off yet stay hidden, the seed until the last lands. */
async function view(env: Env, l: LotteryRow, memberId: string | null, at: number): Promise<LotteryView> {
  const [entries, winners, ranks, totals, mine, host, opted] = await Promise.all([
    lockedEntries(env, l, at),
    winnerRows(env, l),
    memberId ? ranksOf(env) : new Map<string, number>(),
    env.DB.prepare("SELECT COALESCE(SUM(cheers), 0) AS cheers FROM lottery_watchers WHERE lottery_id = ?")
      .bind(l.id)
      .first<{ cheers: number }>(),
    memberId
      ? env.DB.prepare("SELECT cheers FROM lottery_watchers WHERE lottery_id = ? AND member_id = ?")
          .bind(l.id, memberId)
          .first<{ cheers: number }>()
      : null,
    l.drawn_by ? payeeName(env.DB, l.drawn_by) : null,
    memberId
      ? env.DB.prepare("SELECT 1 AS x FROM lottery_optouts WHERE lottery_id = ? AND member_id = ?")
          .bind(l.id, memberId)
          .first<{ x: number }>()
      : null,
  ]);
  const drawnAt = l.drawn_at ? Date.parse(l.drawn_at) : null;
  const shown = drawnAt === null ? [] : winners.filter((w) => drawStart(drawnAt, w.drawNo) <= at);
  const done = drawnAt !== null && at >= drawEnd(drawnAt, winners.length);
  const inPool = memberId ? entries.find((e) => e.id === memberId) : undefined;
  return {
    id: l.id,
    title: l.title,
    poolSize: l.pool_size,
    prizes: prizesOf(l),
    drawAt: l.draw_at,
    status: l.status === "drawn" ? "drawn" : "open",
    seedHash: l.seed_hash,
    seed: done ? l.seed : null,
    drawnAt: l.drawn_at,
    host,
    now: new Date(at).toISOString(),
    entries,
    winners: shown,
    draws: l.status === "drawn" ? winners.length : prizeSlots(prizesOf(l)).length,
    me: memberId
      ? {
          id: memberId,
          rank: inPool?.rank ?? ranks.get(memberId) ?? null,
          inPool: !!inPool,
          cheers: mine?.cheers ?? 0,
          optedOut: !!opted,
          canOpt: l.status === "open" && l.locked !== 1 && (!!inPool || !!opted),
        }
      : null,
    watching: entries.filter((e) => e.online).length,
    cheers: totals?.cheers ?? 0,
    locked: l.locked === 1,
    rehearsal: false,
  };
}

/** GET /api/m/…/lottery: the page, and the member counts as watching. Null when there is none. */
export async function memberLottery(env: Env, memberId: string): Promise<LotteryView | null> {
  const l = await shownLottery(env);
  if (!l) return null;
  const at = Date.now();
  // Until the results are out; after that nobody is counted any more (forgetWatchers).
  if (!l.announced)
    await env.DB.prepare(
      `INSERT INTO lottery_watchers (lottery_id, member_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT DO UPDATE SET seen_at = excluded.seen_at`,
    )
      .bind(l.id, memberId, new Date(at).toISOString())
      .run();
  return view(env, l, memberId, at);
}

/** 打气: `n` more taps (sent a few at a time), up to LOTTERY_CHEERS_MAX each. The new totals. */
export async function cheer(env: Env, memberId: string, n: unknown): Promise<{ cheers: number; mine: number }> {
  const l = await shownLottery(env);
  if (!l || l.status !== "open") throw badRequest("现在不能打气");
  const add = Math.max(0, Math.min(Math.floor(Number(n) || 0), LOTTERY_CHEERS_MAX));
  await env.DB.prepare(
    `INSERT INTO lottery_watchers (lottery_id, member_id, seen_at, cheers) VALUES (?1, ?2, ?3, MIN(?4, ?5))
     ON CONFLICT DO UPDATE SET cheers = MIN(cheers + ?4, ?5), seen_at = ?3`,
  )
    .bind(l.id, memberId, now(), add, LOTTERY_CHEERS_MAX)
    .run();
  const [total, mine] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(cheers), 0) AS n FROM lottery_watchers WHERE lottery_id = ?")
      .bind(l.id)
      .first<{ n: number }>(),
    env.DB.prepare("SELECT cheers AS n FROM lottery_watchers WHERE lottery_id = ? AND member_id = ?")
      .bind(l.id, memberId)
      .first<{ n: number }>(),
  ]);
  return { cheers: total?.n ?? 0, mine: mine?.n ?? 0 };
}

/**
 * 不参加 / 重新参加 on the 抽奖 card (Ke Li 2026-11-16: 从抽奖活动卡片上 opt out): a member takes themselves
 * off the list, or comes back, until it is locked or drawn. They keep their number; nobody takes
 * their place. Someone an admin took off can't put themselves back.
 */
export async function optLottery(env: Env, memberId: string, out: boolean): Promise<void> {
  const l = await shownLottery(env);
  if (!l || l.status !== "open") throw badRequest("抽奖已经开奖或取消了");
  if (l.locked) throw badRequest("名单已经锁定，不能再改了");
  const who = [l.id, memberId];
  // Still open and unlocked when it is written (the draw may start between the check and the write).
  const live = "EXISTS (SELECT 1 FROM lotteries WHERE id = ?1 AND status = 'open' AND locked = 0)";
  if (out) {
    const [mine, entries] = await Promise.all([
      env.DB.prepare("SELECT 1 AS x FROM lottery_entries WHERE lottery_id = ? AND member_id = ?")
        .bind(...who)
        .first<{ x: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM lottery_entries WHERE lottery_id = ?")
        .bind(l.id)
        .first<{ n: number }>(),
    ]);
    if (!mine) return;
    if ((entries?.n ?? 0) - 1 < prizeSlots(prizesOf(l)).length) throw badRequest("参加的人不能比奖品少，请联系管理员");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO lottery_excluded (lottery_id, rank, member_id) SELECT lottery_id, rank, member_id
         FROM lottery_entries WHERE lottery_id = ?1 AND member_id = ?2 AND ${live}`,
      ).bind(...who),
      env.DB.prepare(
        `INSERT OR IGNORE INTO lottery_optouts (lottery_id, member_id) SELECT ?1, ?2 WHERE ${live}
         AND EXISTS (SELECT 1 FROM lottery_entries WHERE lottery_id = ?1 AND member_id = ?2)`,
      ).bind(...who),
      env.DB.prepare(`DELETE FROM lottery_entries WHERE lottery_id = ?1 AND member_id = ?2 AND ${live}`).bind(...who),
    ]);
    return;
  }
  const own = `${live} AND EXISTS (SELECT 1 FROM lottery_optouts o WHERE o.lottery_id = ?1 AND o.member_id = ?2)`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO lottery_entries (lottery_id, rank, member_id) SELECT lottery_id, rank, member_id
       FROM lottery_excluded WHERE lottery_id = ?1 AND member_id = ?2 AND ${own}`,
    ).bind(...who),
    env.DB.prepare(`DELETE FROM lottery_excluded WHERE lottery_id = ?1 AND member_id = ?2 AND ${own}`).bind(...who),
    env.DB.prepare(`DELETE FROM lottery_optouts WHERE lottery_id = ?1 AND member_id = ?2 AND ${live}`).bind(...who),
  ]);
}

// ---- 设置 → 抽奖 ----

interface LotteryInput {
  title: string;
  poolSize: number;
  prizes: LotteryPrize[];
  drawAt: string;
  /** Member ids taken off the list by hand. */
  exclude: string[];
}

/** The member ids to take off the list, from the form. */
function readExclude(body: Record<string, unknown>): string[] {
  const ids = Array.isArray(body.exclude) ? body.exclude : [];
  if (ids.length > LOTTERY_POOL_MAX || ids.some((x) => typeof x !== "string")) throw badRequest("名单有误，请刷新");
  return [...new Set(ids as string[])];
}

/** The form's fields, checked. */
function readInput(body: Record<string, unknown>, rehearsal = false): LotteryInput {
  const prizes = Array.isArray(body.prizes)
    ? (body.prizes as Record<string, unknown>[]).map((p) => ({ name: str(p?.name).trim(), count: Number(p?.count) }))
    : [];
  const input = { title: str(body.title).trim(), poolSize: Number(body.poolSize), prizes };
  const err = checkLottery(input);
  if (err) throw badRequest(err);
  const date = str(body.drawDate);
  const time = str(body.drawTime);
  if (!isDate(date) || !isTime(time)) throw badRequest("请填写开奖时间");
  const drawAt = pacificToUtc(date, time);
  // It starts by itself at that time: a time already past would draw at once. Any minute still to
  // come will do (Ke Li 2026-11-16: 3:02 is after 3:01).
  if (!rehearsal && Date.parse(drawAt) <= Date.now()) throw badRequest("开奖时间要在现在之后");
  return { ...input, drawAt, exclude: readExclude(body) };
}

async function pushMemberCount(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s.member_id) AS n FROM push_subscriptions s JOIN members m ON m.id = s.member_id
     WHERE m.status = 'active' AND m.deleted_at IS NULL`,
  ).first<{ n: number }>();
  return r?.n ?? 0;
}

/** GET /api/admin/…/lottery: the 抽奖 under way (as members see it), or the list publishing would lock. */
export async function adminLottery(env: Env, size: number, canLock: boolean): Promise<LotteryAdmin> {
  const l = await shownLottery(env);
  const at = Date.now();
  const n = Number.isInteger(size) && size >= 1 && size <= 1000 ? size : 100;
  const [current, preview, excluded, selfOut, members, pushMembers] = await Promise.all([
    l ? view(env, l, null, at) : null,
    l ? [] : previewEntries(env, n),
    l ? excludedEntries(env, l) : [],
    l ? selfOutIds(env, l.id) : [],
    memberCount(env),
    pushMemberCount(env),
  ]);
  return { current, preview, excluded, selfOut, members, pushMembers, canLock };
}

/**
 * GET /api/admin/…/lottery/history: every 抽奖 that is over (Ke Li 2026-11-16: 保留历次抽奖的记录，
 * 比如哪些人参加了，随机数，结果和奖品), newest first: drawn with its last shuttle landed, or
 * cancelled. Nothing is ever deleted from these tables but by 清空所有数据.
 */
export async function lotteryHistory(env: Env, at = Date.now()): Promise<LotteryRecord[]> {
  const { results: all } = await env.DB.prepare(
    "SELECT * FROM lotteries WHERE status IN ('drawn', 'cancelled') ORDER BY id DESC LIMIT 50",
  ).all<LotteryRow>();
  const rows = all.filter(
    (l) =>
      l.status === "cancelled" || (l.drawn_at && at >= drawEnd(Date.parse(l.drawn_at), prizeSlots(prizesOf(l)).length)),
  );
  if (rows.length === 0) return [];
  const ids = JSON.stringify(rows.map((l) => l.id));
  const people = (table: string) =>
    env.DB.prepare(
      `SELECT x.lottery_id AS id, x.rank, COALESCE(m.username, x.member_id) AS name
       FROM ${table} x LEFT JOIN members m ON m.id = x.member_id
       WHERE x.lottery_id IN (SELECT value FROM json_each(?)) ORDER BY x.rank`,
    )
      .bind(ids)
      .all<{ id: number; rank: number; name: string }>();
  const [entries, excluded, winners, hosts] = await Promise.all([
    people("lottery_entries"),
    people("lottery_excluded"),
    env.DB.prepare(
      `SELECT lottery_id AS id, draw_no AS drawNo, rank, prize FROM lottery_winners
       WHERE lottery_id IN (SELECT value FROM json_each(?)) ORDER BY draw_no`,
    )
      .bind(ids)
      .all<LotteryWinner & { id: number }>(),
    Promise.all(rows.map((l) => (l.created_by ? payeeName(env.DB, l.created_by) : null))),
  ]);
  return rows.map((l, i) => {
    const mine = entries.results.filter((e) => e.id === l.id);
    const names = new Map(mine.map((e) => [e.rank, e.name]));
    return {
      id: l.id,
      title: l.title,
      status: l.status === "cancelled" ? "cancelled" : "drawn",
      poolSize: l.pool_size,
      prizes: prizesOf(l),
      drawAt: l.draw_at,
      createdAt: l.created_at,
      host: hosts[i] ?? null,
      seed: l.seed,
      seedHash: l.seed_hash,
      entries: mine.map(({ rank, name }) => ({ rank, name })),
      excluded: excluded.results.filter((e) => e.id === l.id).map(({ rank, name }) => ({ rank, name })),
      winners: winners.results
        .filter((w) => w.id === l.id)
        .map(({ drawNo, rank, prize }) => ({ drawNo, rank, prize, name: names.get(rank) ?? "" })),
    };
  });
}

const lockedError = () => new HttpError(409, "lottery_locked", "群主已锁定这个抽奖，解锁后才能修改");

/**
 * 锁定 / 解锁 (Ke Li 2026-11-16: 群主可以锁定，锁定之后任何人都不能改了，除非群主解锁): the Owner only
 * (access.ts). Locked, nobody can change or cancel it; it still draws by itself on time.
 */
export async function lockLottery(env: Env, id: number, locked: boolean): Promise<LotteryRow> {
  const l = await lotteryById(env, id);
  const res = await env.DB.prepare("UPDATE lotteries SET locked = ? WHERE id = ? AND status = 'open'")
    .bind(locked ? 1 : 0, id)
    .run();
  if (!res.meta.changes) throw statusError();
  return l;
}

const statusError = () => new HttpError(409, "lottery_changed", "抽奖的状态已经变了，请刷新");

async function lotteryById(env: Env, id: number): Promise<LotteryRow> {
  if (!Number.isSafeInteger(id)) throw new HttpError(404, "not_found", "找不到这个抽奖");
  const l = await env.DB.prepare("SELECT * FROM lotteries WHERE id = ?").bind(id).first<LotteryRow>();
  if (!l) throw new HttpError(404, "not_found", "找不到这个抽奖");
  return l;
}

/** The members to push to: every active one with push on, or just these. */
async function queuePush(env: Env, msg: PushMessage, only?: string[]): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO push_outbox (endpoint, member_id, kind, payload, created_at)
     SELECT s.endpoint, s.member_id, 'lottery', ?1, ?2 FROM push_subscriptions s JOIN members m ON m.id = s.member_id
     WHERE m.status = 'active' AND m.deleted_at IS NULL
       AND (?3 IS NULL OR m.id IN (SELECT value FROM json_each(?3)))`,
  )
    .bind(JSON.stringify(msg), now(), only ? JSON.stringify(only) : null)
    .run();
  return res.meta.changes;
}

const LOTTERY_URL = "/me?lottery=1";
const prizeLine = (prizes: LotteryPrize[]) => prizes.map((p) => `${p.name} ×${p.count}`).join("、");
const whenZh = (iso: string) => {
  const p = toPacific(iso);
  return `${Number(p.date.slice(5, 7))}月${Number(p.date.slice(8))}日 ${p.time}`;
};

/** 公布抽奖: locks the first N, makes the seed, tells everyone. */
export async function createLottery(env: Env, actor: Actor, body: Record<string, unknown>): Promise<LotteryRow> {
  const input = readInput(body);
  const seed = newSeed();
  const at = now();
  const row = await env.DB.prepare(
    `INSERT INTO lotteries (title, pool_size, prizes, draw_at, next_goal, status, seed, seed_hash, created_by, created_at)
     SELECT ?, ?, ?, ?, NULL, 'open', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lotteries WHERE status = 'open')
     RETURNING *`,
  )
    .bind(
      input.title,
      input.poolSize,
      JSON.stringify(input.prizes),
      input.drawAt,
      seed,
      await sha256Hex(seed),
      actor.memberId,
      at,
    )
    .first<LotteryRow>();
  if (!row) throw badRequest("已经有一个抽奖在进行，先开奖或取消它");
  const firstN = `SELECT id, ROW_NUMBER() OVER (ORDER BY ${ORDER}) AS rank FROM members WHERE ${ELIGIBLE}`;
  const out = JSON.stringify(input.exclude);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO lottery_entries (lottery_id, rank, member_id)
       SELECT ?1, rank, id FROM (${firstN}) WHERE rank <= ?2 AND id NOT IN (SELECT value FROM json_each(?3))`,
    ).bind(row.id, input.poolSize, out),
    env.DB.prepare(
      `INSERT INTO lottery_excluded (lottery_id, rank, member_id)
       SELECT ?1, rank, id FROM (${firstN}) WHERE rank <= ?2 AND id IN (SELECT value FROM json_each(?3))`,
    ).bind(row.id, input.poolSize, out),
    // An earlier one's results come off 我的活动.
    env.DB.prepare("UPDATE lotteries SET hidden_at = ? WHERE status = 'drawn' AND hidden_at IS NULL").bind(at),
  ]);
  const entries = await env.DB.prepare("SELECT COUNT(*) AS n FROM lottery_entries WHERE lottery_id = ?")
    .bind(row.id)
    .first<{ n: number }>();
  if ((entries?.n ?? 0) < prizeSlots(input.prizes).length) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM lottery_entries WHERE lottery_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM lottery_excluded WHERE lottery_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM lotteries WHERE id = ?").bind(row.id),
    ]);
    throw badRequest("奖品比参加的人还多");
  }
  await queuePush(env, {
    title: `🎉 ${input.title}`,
    body: `前 ${input.poolSize} 名入群的球友参加，${whenZh(input.drawAt)} 开奖\n奖品：${prizeLine(input.prizes)}`,
    url: LOTTERY_URL,
    tag: `lottery-${row.id}`,
  });
  return row;
}

/** 修改: name, prizes and time, until 开奖. The list stays as it was locked. */
export async function editLottery(env: Env, id: number, body: Record<string, unknown>): Promise<void> {
  const l = await lotteryById(env, id);
  if (l.status !== "open") throw statusError();
  if (l.locked) throw lockedError();
  const input = readInput({ ...body, poolSize: l.pool_size });
  const entries = await env.DB.prepare("SELECT COUNT(*) AS n FROM lottery_entries WHERE lottery_id = ?")
    .bind(id)
    .first<{ n: number }>();
  if (prizeSlots(input.prizes).length > (entries?.n ?? 0)) throw badRequest("奖品比参加的人还多");
  const res = await env.DB.prepare(
    `UPDATE lotteries SET title = ?1, prizes = ?2, draw_at = ?3,
       reminded = CASE WHEN draw_at = ?3 THEN reminded ELSE 0 END
     WHERE id = ?4 AND status = 'open' AND locked = 0`,
  )
    .bind(input.title, JSON.stringify(input.prizes), input.drawAt, id)
    .run();
  if (!res.meta.changes) throw statusError();
}

/**
 * Who of the first N doesn't take part (Ke Li 2026-11-16: 手动选择): `exclude` is the whole set
 * after the change. Until it is locked or drawn. They keep their number; nobody takes their place.
 */
export async function excludeLottery(env: Env, id: number, body: Record<string, unknown>): Promise<LotteryRow> {
  const l = await lotteryById(env, id);
  if (l.status !== "open") throw statusError();
  if (l.locked) throw lockedError();
  // Whoever left by themselves stays off: only they can come back.
  const out = JSON.stringify([...new Set([...readExclude(body), ...(await selfOutIds(env, id))])]);
  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT member_id FROM lottery_entries WHERE lottery_id = ?1
       UNION ALL SELECT member_id FROM lottery_excluded WHERE lottery_id = ?1)
     WHERE member_id NOT IN (SELECT value FROM json_each(?2))`,
  )
    .bind(id, out)
    .first<{ n: number }>();
  if ((left?.n ?? 0) < prizeSlots(prizesOf(l)).length) throw badRequest("奖品比参加的人还多");
  await env.DB.batch([
    // Back on: whoever is no longer in the set.
    env.DB.prepare(
      `INSERT INTO lottery_entries (lottery_id, rank, member_id) SELECT lottery_id, rank, member_id
       FROM lottery_excluded WHERE lottery_id = ?1 AND member_id NOT IN (SELECT value FROM json_each(?2))`,
    ).bind(id, out),
    env.DB.prepare(
      "DELETE FROM lottery_excluded WHERE lottery_id = ?1 AND member_id NOT IN (SELECT value FROM json_each(?2))",
    ).bind(id, out),
    // Off: whoever is in it.
    env.DB.prepare(
      `INSERT INTO lottery_excluded (lottery_id, rank, member_id) SELECT lottery_id, rank, member_id
       FROM lottery_entries WHERE lottery_id = ?1 AND member_id IN (SELECT value FROM json_each(?2))`,
    ).bind(id, out),
    env.DB.prepare(
      "DELETE FROM lottery_entries WHERE lottery_id = ?1 AND member_id IN (SELECT value FROM json_each(?2))",
    ).bind(id, out),
  ]);
  return l;
}

/** The winners the seed gives for this list and these prizes. */
async function winnersFor(seed: string, ranks: number[], prizes: LotteryPrize[]): Promise<LotteryWinner[]> {
  const slots = prizeSlots(prizes);
  const won = await drawWinners(seed, ranks, slots.length);
  return won.map((rank, i) => ({ drawNo: i + 1, rank, prize: slots[i]! }));
}

/**
 * 开奖 by itself when the countdown reaches 0 (Ke Li 2026-11-16: 开奖应该是倒计时自动开始): the
 * first to ask after the time announced (a page, or the cron) records it, with the time announced as
 * the draw's clock, so every phone plays it from that moment. The seed decided the winners when the
 * list was locked, so two asking at once write the same thing.
 */
async function drawIfDue(env: Env, l: LotteryRow, at: number): Promise<LotteryRow> {
  if (l.status !== "open" || at < Date.parse(l.draw_at)) return l;
  const { results } = await env.DB.prepare("SELECT rank FROM lottery_entries WHERE lottery_id = ?")
    .bind(l.id)
    .all<{ rank: number }>();
  const winners = await winnersFor(
    l.seed,
    results.map((r) => r.rank),
    prizesOf(l),
  );
  await env.DB.batch([
    // Whoever set it up is whom the winners contact.
    env.DB.prepare(
      "UPDATE lotteries SET status = 'drawn', drawn_at = draw_at, drawn_by = created_by WHERE id = ? AND status = 'open'",
    ).bind(l.id),
    ...winners.map((w) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO lottery_winners (lottery_id, draw_no, rank, prize) VALUES (?, ?, ?, ?)",
      ).bind(l.id, w.drawNo, w.rank, w.prize),
    ),
  ]);
  return (await env.DB.prepare("SELECT * FROM lotteries WHERE id = ?").bind(l.id).first<LotteryRow>()) ?? l;
}

export async function cancelLottery(env: Env, id: number): Promise<LotteryRow> {
  const l = await lotteryById(env, id);
  if (l.locked) throw lockedError();
  const res = await env.DB.prepare(
    "UPDATE lotteries SET status = 'cancelled' WHERE id = ? AND status = 'open' AND locked = 0",
  )
    .bind(id)
    .run();
  if (!res.meta.changes) throw statusError();
  await forgetWatchers(env, id);
  return l;
}

/**
 * 打气 and who had the page open are only for the evening itself (Ke Li 2026-11-16: 可以不存数据库).
 * Phones can only see each other's through the server, so they are kept until the draw is over, then
 * dropped; the record of a 抽奖 has neither.
 */
const forgetWatchers = (env: Env, id: number) =>
  env.DB.prepare("DELETE FROM lottery_watchers WHERE lottery_id = ?").bind(id).run();

/** 从我的活动收起: after the draw, the results come off members' pages. */
export async function hideLottery(env: Env, id: number): Promise<LotteryRow> {
  const l = await lotteryById(env, id);
  const res = await env.DB.prepare(
    "UPDATE lotteries SET hidden_at = ? WHERE id = ? AND status = 'drawn' AND hidden_at IS NULL",
  )
    .bind(now(), id)
    .run();
  if (!res.meta.changes) throw statusError();
  return l;
}

// ---- The notices around a draw ----

interface Named extends LotteryWinner {
  name: string;
  memberId: string;
}

async function namedWinners(env: Env, l: LotteryRow, winners: LotteryWinner[]): Promise<Named[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.rank, m.id, m.username FROM lottery_entries e JOIN members m ON m.id = e.member_id WHERE e.lottery_id = ?`,
  )
    .bind(l.id)
    .all<{ rank: number; id: string; username: string }>();
  const byRank = new Map(results.map((r) => [r.rank, r]));
  return winners.map((w) => ({
    ...w,
    name: byRank.get(w.rank)?.username ?? "",
    memberId: byRank.get(w.rank)?.id ?? "",
  }));
}

const num3 = (rank: number) => String(rank).padStart(3, "0");

/** The results as text for the WeChat group (Simplified Chinese, as every text to paste is). */
function wechatResults(l: LotteryRow, winners: Named[], host: string): string {
  return [
    `🎉 ${l.title} 开奖结果`,
    ...winners.map((w) => `${w.prize}：${w.name}（${num3(w.rank)} 号）`),
    `恭喜！请联系 ${host} 领奖 🏸`,
  ]
    .filter(Boolean)
    .join("\n");
}

function resultsMessage(l: LotteryRow, winners: Named[], wechat: string, rehearsal: boolean) {
  return (lang: BotLang) =>
    message(
      lang,
      [
        rehearsal ? bt(lang, "【预演】只发给你，不算数，别人收不到。") : "",
        bt(lang, "「{title}」开奖结果：", { title: l.title }),
        ...winners.map((w) => `${w.prize} — ${w.name} (#${num3(w.rank)})`),
      ]
        .filter(Boolean)
        .join("\n"),
      wechat,
    );
}

/**
 * Once the last draw has landed: each winner's push, and the results to the Owner and admins on
 * Telegram with the text for the WeChat group. Once only, whoever gets here first (a page asking for
 * the results, or the cron).
 */
export async function announceResults(env: Env, at = Date.now()): Promise<boolean> {
  const l = await env.DB.prepare(
    "SELECT * FROM lotteries WHERE status = 'drawn' AND announced = 0 ORDER BY id LIMIT 1",
  ).first<LotteryRow>();
  if (!l?.drawn_at) return false;
  const winners = await winnerRows(env, l);
  if (at < drawEnd(Date.parse(l.drawn_at), winners.length)) return false;
  const claimed = await env.DB.prepare("UPDATE lotteries SET announced = 1 WHERE id = ? AND announced = 0")
    .bind(l.id)
    .run();
  if (!claimed.meta.changes) return false;
  await forgetWatchers(env, l.id);
  const named = await namedWinners(env, l, winners);
  const host = await payeeName(env.DB, l.drawn_by);
  for (const w of named)
    await queuePush(
      env,
      {
        title: "🎉 恭喜你中奖了！",
        body: `你在「${l.title}」抽中了 ${w.prize}，请联系 ${host} 领奖`,
        url: LOTTERY_URL,
        tag: `lottery-win-${l.id}`,
      },
      [w.memberId],
    );
  await sendToOwnerAndAdmins(env, resultsMessage(l, named, wechatResults(l, named, host), false));
  return true;
}

/** Half an hour before the time announced: a push to everyone, and a word to the Owner and admins. Once. */
export async function remindLottery(env: Env, at = Date.now()): Promise<boolean> {
  const l = await env.DB.prepare(
    `SELECT * FROM lotteries WHERE status = 'open' AND reminded = 0 AND draw_at <= ?1 AND draw_at > ?2
     ORDER BY id LIMIT 1`,
  )
    .bind(new Date(at + 30 * 60_000).toISOString(), new Date(at - 60 * 60_000).toISOString())
    .first<LotteryRow>();
  if (!l) return false;
  const claimed = await env.DB.prepare("UPDATE lotteries SET reminded = 1 WHERE id = ? AND reminded = 0")
    .bind(l.id)
    .run();
  if (!claimed.meta.changes) return false;
  await queuePush(env, {
    title: `⏰ ${l.title} 快开奖了`,
    body: `${toPacific(l.draw_at).time} 开奖，打开看看你在墙上的位置`,
    url: LOTTERY_URL,
    tag: `lottery-${l.id}`,
  });
  await sendToOwnerAndAdmins(env, (lang) =>
    message(
      lang,
      bt(lang, "「{title}」{time} 倒计时结束自动开奖，大家的手机会一起看。", {
        title: l.title,
        time: botInstant(lang, l.draw_at),
      }),
    ),
  );
  return true;
}

/** The cron's part: the reminder before, the draw if nobody has looked, the results after. */
export async function lotteryCron(env: Env): Promise<void> {
  await remindLottery(env);
  await shownLottery(env); // draws it, if its time has come and nobody has looked

  await announceResults(env);
}

// ---- 预演 ----

/**
 * 预演 (Ke Li 2026-11-16): the whole draw on the real list (the one locked, or the one publishing
 * would lock), with a seed of its own so it says nothing about the real result. Saved nowhere; the
 * notices go to whoever pressed it, marked 预演, so they can see what the group will get.
 */
export async function rehearseLottery(
  env: Env,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<LotteryRehearsal> {
  const shown = await shownLottery(env);
  const l = shown?.status === "open" ? shown : null;
  const at = Date.now();
  const input = l
    ? { title: l.title, poolSize: l.pool_size, prizes: prizesOf(l), drawAt: l.draw_at, exclude: [] }
    : readInput(body, true);
  const off = new Set(input.exclude);
  const first = l ? [] : await previewEntries(env, input.poolSize);
  const entries = l ? await lockedEntries(env, l, at) : first.filter((e) => !off.has(e.id));
  const excluded = l ? (await excludedEntries(env, l)).length : first.length - entries.length;
  if (entries.length < prizeSlots(input.prizes).length) throw badRequest("奖品比参加的人还多");
  const seed = newSeed();
  const winners = await winnersFor(
    seed,
    entries.map((e) => e.rank),
    input.prizes,
  );
  const fake: LotteryRow = {
    id: 0,
    title: input.title,
    pool_size: input.poolSize,
    prizes: JSON.stringify(input.prizes),
    draw_at: input.drawAt,
    next_goal: null,
    status: "drawn",
    seed,
    seed_hash: await sha256Hex(seed),
    created_by: actor.memberId,
    created_at: new Date(at).toISOString(),
    drawn_at: new Date(at).toISOString(),
    drawn_by: actor.memberId,
    reminded: 1,
    announced: 1,
    hidden_at: null,
    locked: 0,
  };
  const host = await payeeName(env.DB, actor.memberId);
  const byRank = new Map(entries.map((e) => [e.rank, e]));
  const named = winners.map((w) => ({
    ...w,
    name: byRank.get(w.rank)?.name ?? "",
    memberId: byRank.get(w.rank)?.id ?? "",
  }));
  const [pushMembers, devices] = await Promise.all([
    pushMemberCount(env),
    actor.memberId
      ? queuePush(
          env,
          {
            title: `【预演】🎉 ${input.title}`,
            body: `只发给你，不算数。中奖：${named.map((w) => `${w.prize} ${w.name}`).join("、")}`,
            url: "/admin/google?tab=settings&sub=lottery",
            tag: "lottery-rehearsal",
          },
          [actor.memberId],
        )
      : 0,
  ]);
  const telegram = actor.memberId
    ? await sendToMember(env, actor.memberId, resultsMessage(fake, named, wechatResults(fake, named, host), true))
    : false;
  return {
    view: {
      id: 0,
      title: input.title,
      poolSize: input.poolSize,
      prizes: input.prizes,
      drawAt: input.drawAt,
      status: "drawn",
      seedHash: fake.seed_hash,
      seed,
      drawnAt: fake.drawn_at,
      host,
      now: fake.drawn_at!,
      // Everyone counts as watching: the faces show as they will on the night.
      entries: entries.map((e) => ({ ...e, online: true })),
      winners,
      draws: winners.length,
      me: null,
      watching: entries.length,
      cheers: 0,
      locked: false,
      rehearsal: true,
    },
    checks: {
      entries: entries.length,
      excluded,
      poolSize: input.poolSize,
      noAvatar: entries.filter((e) => !e.avatar).length,
      pushMembers,
      myDevices: devices,
      telegram,
    },
  };
}
