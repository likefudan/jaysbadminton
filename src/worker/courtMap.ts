import {
  COURT_MAP_HISTORY_DAYS,
  COURT_MAP_HISTORY_MAX,
  COURT_MAP_ITEMS_MAX,
  type CourtMapLayout,
  type CourtMapOld,
  type CourtMapPastVenue,
  type CourtMapRead,
  type CourtMapVenue,
  cleanLayout,
  courtMapPlace,
} from "../shared/courtMap";
import { toPacific } from "../shared/time";
import type { Actor } from "./access";
import { aiEnabled, aiRequestCost, askAi } from "./ai";
import { actorId, groupAudit, OWNER } from "./audit";
import { now } from "./db";
import type { Env } from "./env";
import { checkVenue } from "./events";
import { badRequest } from "./http";

/**
 * 球场图 (Ke Li 2026-11-15): one floor plan per venue, the venue being its address (courtMapPlace).
 * Read from a photo of the venue's posted court map by the 拍照登记 model, then fixed by hand in
 * the page (numbers, positions, courts added or removed); the photo is kept only until the model
 * has answered (as with 拍照登记, it is for the model alone). The Owner, admins and organizers add, change and remove it in
 * 设置 → 球场图 (Ke Li: 在设置里管理); an event's 球场排队 card only shows it.
 */

/** A venue as events and 最近的场馆 carry it: its name and address as typed. */
export interface Venue {
  location: string;
  address: string;
}

/** The venue a 设置 request is about. */
export function venueOf(body: Record<string, unknown>): Venue {
  const location = typeof body.venue === "string" ? body.venue.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  checkVenue(location, address);
  return { location, address };
}

/**
 * Photos a month (Pacific) for one venue, and from one person (Ke Li 2026-11-15: 避免滥用). A read
 * takes the model a while at high effort, so each costs far more than a 拍照登记 photo.
 */
export const COURT_MAP_PHOTOS_MONTH = 10;
const MAX_BYTES = 2_000_000;

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    aspect: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["court", "area", "text"] },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
        required: ["kind", "label", "x", "y", "w", "h"],
        additionalProperties: false,
      },
    },
  },
  required: ["found", "aspect", "items"],
  additionalProperties: false,
};

const PROMPT = `This is a phone photo of a badminton venue's court map: a floor plan, usually printed and posted on a wall, with numbered rectangles for the courts.

Set found to false and return no items if the photo is not such a floor plan.

Otherwise describe the plan inside its outer border (the outline of the hall), ignoring the paper, the wall, the logo and the title. Use coordinates as fractions of that border: x and y of each box's top-left corner from 0 (left / top) to 1 (right / bottom), w and h its width and height as fractions too. Correct for the photo's perspective so rows and columns that line up on the plan line up in your answer. aspect is the border's width divided by its height, as drawn on the plan.

Courts are built in straight rows and columns, all the same size and never at an angle: give every court in a row the same y and h, and every court in a column the same x and w.

Items:
- kind "court": each badminton court with a number; label is just the number, e.g. "17".
- kind "area": every other box on the plan, e.g. courts for other sports ("A", "B"), a court with letters (e.g. "JR"), the front desk, sign-up stations, restrooms drawn as boxes; label is its text as printed, short. Leave out small marks that have no text (fire extinguishers, pillars, doors).
- kind "text": every free-standing label, e.g. "BADMINTON COURTS", "PICKLEBALL COURTS", "RESTROOMS", "ENTRANCE", with the box its text takes up.

Read every label on the plan and check each court number against its neighbours: numbers run in order along a row.

Give at most ${COURT_MAP_ITEMS_MAX} items. Do not invent courts you cannot see.`;

export async function getCourtMap(env: Env, e: Venue): Promise<CourtMapLayout | null> {
  const row = await env.DB.prepare("SELECT layout FROM court_maps WHERE place = ?")
    .bind(courtMapPlace(e.location, e.address))
    .first<{ layout: string }>();
  if (!row) return null;
  try {
    return cleanLayout(JSON.parse(row.layout));
  } catch {
    return null;
  }
}

function checkJpeg(v: unknown) {
  if (typeof v !== "string" || !v) throw badRequest("请选择一张照片");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  } catch {
    throw badRequest("照片格式不对，请重新拍一张");
  }
  // It waits for the reader in a database row, as text: 2 MB at most for the whole row.
  if (bytes.length > MAX_BYTES || v.length > 1_900_000) throw badRequest("照片太大了，请重新拍一张");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw badRequest("照片格式不对，请重新拍一张");
}

/** A photo the model has had this long without an answer is given up (the model gets two minutes). */
const READ_STALE_MS = 10 * 60_000;

/**
 * 拍照: takes the photo and hands it to the reader; the answer comes later (Ke Li 2026-11-15: 拍了
 * 之后可以返回其他页面，过一会儿回来看结果), in 设置 → 球场图 on the venue. Only the Owner and admins
 * may, ten a month for a venue and ten a month each, one at a time per venue.
 */
export async function sendCourtMapPhoto(
  env: Env,
  actor: Pick<Actor, "memberId">,
  body: Record<string, unknown>,
): Promise<void> {
  if (!aiEnabled(env)) throw badRequest("拍照识别还没有开通");
  const venue = venueOf(body);
  checkJpeg(body.image);
  const place = courtMapPlace(venue.location, venue.address);
  const who = actorId(actor);
  const ts = now();
  const month = toPacific(ts).date.slice(0, 7);
  const used = await env.DB.prepare(
    `SELECT COALESCE(SUM(place = ?1 AND month = ?3), 0) AS here,
       COALESCE(SUM(member_id = ?2 AND month = ?3), 0) AS mine,
       COALESCE(SUM(place = ?1 AND state = 'pending'), 0) AS waiting
     FROM court_map_photos WHERE place = ?1 OR (member_id = ?2 AND month = ?3)`,
  )
    .bind(place, who, month)
    .first<{ here: number; mine: number; waiting: number }>();
  if (used?.waiting) throw badRequest("这家球馆有一张照片正在识别，请等它好了再拍");
  if ((used?.here ?? 0) >= COURT_MAP_PHOTOS_MONTH) throw badRequest("这家球馆这个月已经拍了 10 张，请下个月再拍");
  if ((used?.mine ?? 0) >= COURT_MAP_PHOTOS_MONTH) throw badRequest("你这个月已经拍了 10 张，请下个月再拍");
  // Counted before the model is asked, so photos sent at once can't get past the limit. What an
  // earlier photo of the venue came to is replaced by this one.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE court_map_photos SET state = 'done', layout = NULL WHERE place = ? AND state != 'pending'",
    ).bind(place),
    env.DB.prepare(
      `INSERT INTO court_map_photos (place, venue, address, member_id, month, request, state, image, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(place, venue.location, venue.address, who, month, crypto.randomUUID(), body.image as string, ts),
  ]);
  await startCourtMapReader(env);
}

/** Wakes the reader (a PushSender of its own, off any request). Never throws: the cron wakes it otherwise. */
async function startCourtMapReader(env: Env): Promise<void> {
  try {
    await env.PUSH.get(env.PUSH.idFromName("court-map")).readMaps();
  } catch (err) {
    console.error("court map reader failed to start:", err);
  }
}

interface PhotoJob {
  id: number;
  place: string;
  venue: string;
  member_id: string;
  month: string;
  request: string;
  image: string | null;
}

/**
 * The reader's run: every photo waiting goes to the model, one after another, and what came of it
 * is kept on its row for the page. Each photo is taken by one run only.
 */
export async function readCourtMapPhotos(env: Env): Promise<void> {
  if (!aiEnabled(env)) return;
  for (;;) {
    const job = await env.DB.prepare(
      `UPDATE court_map_photos SET started_at = ? WHERE id =
         (SELECT id FROM court_map_photos WHERE state = 'pending' AND started_at IS NULL ORDER BY id LIMIT 1)
       RETURNING id, place, venue, member_id, month, request, image`,
    )
      .bind(now())
      .first<PhotoJob>();
    if (!job) return;
    let raw: unknown;
    try {
      // The 拍照登记 model, but asked to take care and given time (Ke Li 2026-11-15: read at 低 it
      // left out labels and boxes): a venue's plan is read once and then kept, a queue screen many
      // times a night.
      raw = await askAi(
        env,
        "photo",
        { text: PROMPT, image: job.image ?? "", schema: SCHEMA, maxTokens: 32000 },
        { effort: "high", callMs: 120_000, request: job.request },
      );
    } catch (err) {
      console.error("court map photo read failed:", err);
    }
    const layout = raw === undefined || (raw as { found?: unknown }).found === false ? null : cleanLayout(raw);
    await finishPhoto(env, job, raw === undefined ? "failed" : layout ? "ready" : "none", layout);
  }
}

/** The photo is let go, the outcome and its cost written down, and the read goes into 群操作记录. */
async function finishPhoto(env: Env, job: PhotoJob, state: "ready" | "none" | "failed", layout: CourtMapLayout | null) {
  const cost = await aiRequestCost(env, job.request);
  await env.DB.prepare(
    "UPDATE court_map_photos SET state = ?, ok = ?, cost = ?, layout = ?, image = NULL, finished_at = ? WHERE id = ?",
  )
    .bind(state, layout ? 1 : 0, cost, layout ? JSON.stringify(layout) : null, now(), job.id)
    .run();
  const nth = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM court_map_photos WHERE place = ? AND month = ? AND id <= ?",
  )
    .bind(job.place, job.month, job.id)
    .first<{ n: number }>();
  const price = cost === null ? "费用未知" : `费用估算 $${cost.toFixed(2)}`;
  await groupAudit(
    env,
    { memberId: job.member_id === OWNER ? null : job.member_id },
    "settings",
    null,
    `拍照识别「${job.venue}」的球场图${layout ? "" : "（没有识别出来）"}，${price}，这家球馆本月第 ${nth?.n ?? 1} 张`,
  );
}

/**
 * Cron: a photo the reader took and never answered (its run died) is given up, and one it never
 * took (it could not be woken) gets it woken again.
 */
export async function tendCourtMapPhotos(env: Env, at = new Date()) {
  const { results } = await env.DB.prepare(
    `SELECT id, place, venue, member_id, month, request, image, started_at FROM court_map_photos
     WHERE state = 'pending'`,
  ).all<PhotoJob & { started_at: string | null }>();
  const floor = new Date(at.getTime() - READ_STALE_MS).toISOString();
  for (const job of results) if (job.started_at && job.started_at < floor) await finishPhoto(env, job, "failed", null);
  if (results.some((job) => !job.started_at)) await startCourtMapReader(env);
}

/** 不要了 / 知道了: what the venue's last photo came to is put away. One still with the model stays. */
export async function dropCourtMapRead(env: Env, e: Venue) {
  await env.DB.prepare(
    "UPDATE court_map_photos SET state = 'done', layout = NULL WHERE place = ? AND state != 'pending'",
  )
    .bind(courtMapPlace(e.location, e.address))
    .run();
}

/** 以前的图 are kept this long, and this many per venue (Ke Li: 防止误操作). */
const HISTORY_MS = COURT_MAP_HISTORY_DAYS * 24 * 3600_000;
const historyFloor = (at: string) => new Date(Date.parse(at) - HISTORY_MS).toISOString();

/** The venue's plan as it is now goes into 以前的图; older ones past 30 days or the newest 10 go. */
function keepOld(env: Env, place: string, at: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `INSERT INTO court_map_history (place, layout, updated_by, updated_at, replaced_at)
       SELECT place, layout, updated_by, updated_at, ? FROM court_maps WHERE place = ?`,
    ).bind(at, place),
    env.DB.prepare(
      `DELETE FROM court_map_history WHERE place = ?1 AND (replaced_at < ?2 OR id NOT IN
         (SELECT id FROM court_map_history WHERE place = ?1 ORDER BY id DESC LIMIT ?3))`,
    ).bind(place, historyFloor(at), COURT_MAP_HISTORY_MAX),
  ];
}

/** 保存: the layout as fixed in the page becomes the venue's one plan; the one before it is kept. */
export async function saveCourtMap(env: Env, e: Venue, memberId: string, body: Record<string, unknown>) {
  const layout = cleanLayout(body.layout);
  if (!layout) throw badRequest("球场图里至少要有一片场地");
  const place = courtMapPlace(e.location, e.address);
  const json = JSON.stringify(layout);
  const ts = now();
  // Saved again unchanged (修改 then 保存 at once): nothing to keep.
  const cur = await env.DB.prepare("SELECT layout FROM court_maps WHERE place = ?")
    .bind(place)
    .first<{ layout: string }>();
  // The plan a photo came to, once saved, is no longer waiting on the venue.
  const read =
    body.read === true
      ? [
          env.DB.prepare(
            "UPDATE court_map_photos SET state = 'done', layout = NULL WHERE place = ? AND state != 'pending'",
          ).bind(place),
        ]
      : [];
  if (cur?.layout === json) {
    if (read.length) await env.DB.batch(read);
    return;
  }
  await env.DB.batch([
    ...read,
    ...keepOld(env, place, ts),
    env.DB.prepare(
      `INSERT INTO court_maps (place, venue, address, layout, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (place) DO UPDATE SET venue = excluded.venue, address = excluded.address,
         layout = excluded.layout, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(place, e.location.trim(), e.address.trim(), json, memberId, ts),
  ]);
}

/** 删除: the venue has no plan any more; the one removed is kept with 以前的图. */
export async function removeCourtMap(env: Env, e: Venue) {
  const place = courtMapPlace(e.location, e.address);
  await env.DB.batch([
    ...keepOld(env, place, now()),
    env.DB.prepare("DELETE FROM court_maps WHERE place = ?").bind(place),
  ]);
}

/** 以前的图 of the event's venue, newest first, each ready to open in the editor and save again. */
export async function courtMapHistory(env: Env, e: Venue): Promise<CourtMapOld[]> {
  const { results } = await env.DB.prepare(
    `SELECT h.id, h.layout, h.updated_at, h.replaced_at, m.username AS by_name
     FROM court_map_history h LEFT JOIN members m ON m.id = h.updated_by
     WHERE h.place = ? AND h.replaced_at >= ? ORDER BY h.id DESC LIMIT ?`,
  )
    .bind(courtMapPlace(e.location, e.address), historyFloor(now()), COURT_MAP_HISTORY_MAX)
    .all<{ id: number; layout: string; updated_at: string; replaced_at: string; by_name: string | null }>();
  const out: CourtMapOld[] = [];
  for (const r of results) {
    let layout: CourtMapLayout | null = null;
    try {
      layout = cleanLayout(JSON.parse(r.layout));
    } catch {}
    if (layout)
      out.push({ id: r.id, layout, savedBy: r.by_name ?? "", savedAt: r.updated_at, replacedAt: r.replaced_at });
  }
  return out;
}

/** Cron: 以前的图 go after 30 days, also at venues nobody saves a plan for any more. */
export async function purgeCourtMapHistory(env: Env, at = new Date()) {
  await env.DB.prepare("DELETE FROM court_map_history WHERE replaced_at < ?")
    .bind(historyFloor(at.toISOString()))
    .run();
}

/**
 * Plans saved under a place as an earlier version spelled it move to the place their address has
 * now, with their 以前的图; where two meet, the one saved last stays.
 */
export async function rekeyCourtMaps(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT place, venue, address FROM court_maps ORDER BY updated_at DESC",
  ).all<{ place: string; venue: string; address: string }>();
  const taken = new Set<string>();
  // Rows that lose their place go first, so the one moving in finds it free.
  const drop: D1PreparedStatement[] = [];
  const move: D1PreparedStatement[] = [];
  for (const r of results) {
    const place = courtMapPlace(r.venue, r.address);
    if (taken.has(place))
      drop.push(
        ...keepOld(env, r.place, now()),
        env.DB.prepare("DELETE FROM court_maps WHERE place = ?").bind(r.place),
      );
    else if (place !== r.place)
      move.push(env.DB.prepare("UPDATE court_maps SET place = ? WHERE place = ?").bind(place, r.place));
    if (place !== r.place)
      move.push(env.DB.prepare("UPDATE court_map_history SET place = ? WHERE place = ?").bind(place, r.place));
    taken.add(place);
  }
  if (drop.length + move.length) await env.DB.batch([...drop, ...move]);
}

/**
 * 添加球馆 → 历史活动的球馆 (Ke Li 2026-11-15: 历史活动过的球馆也应该可以添加): the venues of all
 * events there have been that `listed` doesn't have, one per place, the latest event's first.
 */
export async function courtMapPastVenues(env: Env, listed: CourtMapVenue[]): Promise<CourtMapPastVenue[]> {
  const { results } = await env.DB.prepare(
    `SELECT location, address, MAX(date) AS date FROM events WHERE location != ''
     GROUP BY location, address ORDER BY MAX(start_at) DESC LIMIT 200`,
  ).all<{ location: string; address: string; date: string }>();
  const seen = new Set(listed.map((v) => courtMapPlace(v.venue, v.address)));
  const out: CourtMapPastVenue[] = [];
  for (const r of results) {
    const place = courtMapPlace(r.location, r.address);
    if (seen.has(place)) continue;
    seen.add(place);
    out.push({ venue: r.location, address: r.address, date: r.date });
  }
  return out;
}

const NO_MAP = { map: null, updatedAt: null, savedBy: null, read: null };

/**
 * 设置 → 球场图: the venues to choose from, each with its plan when it has one. They are 最近的场馆
 * and every venue that already has a plan (it may have dropped off that list), one row per place.
 */
export async function courtMapVenues(env: Env): Promise<CourtMapVenue[]> {
  await rekeyCourtMaps(env);
  const [maps, recent, reads] = await env.DB.batch<Record<string, string | null>>([
    env.DB.prepare(
      `SELECT c.place, c.venue, c.address, c.layout, c.updated_at, m.username AS by_name
       FROM court_maps c LEFT JOIN members m ON m.id = c.updated_by ORDER BY c.updated_at DESC`,
    ),
    env.DB.prepare("SELECT name, address FROM locations ORDER BY last_used_at DESC LIMIT 30"),
    // What each venue's last photo came to, until it is saved or put away.
    env.DB.prepare(
      `SELECT p.place, p.venue, p.address, p.state, p.layout, p.created_at, m.username AS by_name
       FROM court_map_photos p
       LEFT JOIN members m ON m.id = p.member_id OR (p.member_id = '${OWNER}' AND m.is_owner = 1)
       WHERE p.state != 'done' ORDER BY p.id`,
    ),
  ]);
  const out = new Map<string, CourtMapVenue>();
  for (const r of recent!.results) {
    const place = courtMapPlace(r.name!, r.address!);
    if (!out.has(place)) out.set(place, { venue: r.name!, address: r.address!, ...NO_MAP });
  }
  for (const m of maps!.results) {
    let map: CourtMapLayout | null = null;
    try {
      map = cleanLayout(JSON.parse(m.layout!));
    } catch {}
    if (!map) continue;
    const known = out.get(m.place!);
    // The name as events use it now, when the venue is still on the list.
    out.set(m.place!, {
      venue: known?.venue ?? m.venue!,
      address: m.address!,
      map,
      updatedAt: m.updated_at!,
      savedBy: m.by_name ?? "",
      read: null,
    });
  }
  for (const r of reads!.results) {
    let layout: CourtMapLayout | null = null;
    try {
      if (r.layout) layout = cleanLayout(JSON.parse(r.layout));
    } catch {}
    const state = r.state === "ready" && !layout ? "failed" : (r.state as CourtMapRead["state"]);
    const read: CourtMapRead = { state, by: r.by_name ?? "", at: r.created_at!, layout };
    const known = out.get(r.place!) ?? { venue: r.venue!, address: r.address!, ...NO_MAP };
    out.set(r.place!, { ...known, read });
  }
  // Venues with a photo's answer or a plan first, then the rest as 最近的场馆 has them.
  const rank = (v: CourtMapVenue) => (v.read ? 2 : v.map ? 1 : 0);
  return [...out.values()].sort((a, b) => rank(b) - rank(a));
}
