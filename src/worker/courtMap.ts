import {
  COURT_MAP_HISTORY_DAYS,
  COURT_MAP_HISTORY_MAX,
  COURT_MAP_ITEMS_MAX,
  type CourtMapLayout,
  type CourtMapOld,
  cleanLayout,
  courtMapPlace,
} from "../shared/courtMap";
import { aiEnabled, askAi } from "./ai";
import { now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest, HttpError } from "./http";

/**
 * 球场图 (Ke Li 2026-11-15): one floor plan per venue, the venue being its address (courtMapPlace).
 * Read from a photo of the venue's posted court map by the 拍照登记 model, then fixed by hand in
 * the page (numbers, positions, courts added or removed); the photo is only sent to the model,
 * never kept (as with 拍照登记). The Owner, admins and organizers add, change and remove it from
 * the 球场排队 card of any event at the venue.
 */

/** Same limit as 拍照登记 (the two share the count): a stuck button can't run up the bill. */
const PER_HOUR = 20;
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
- kind "area": every other box on the plan, e.g. courts for other sports, a court with letters (e.g. "JR"), the front desk, sign-up stations, restrooms drawn as boxes; label is its text as printed, short ("" if none).
- kind "text": a free-standing label such as "BADMINTON COURTS" or "ENTRANCE", with the box it takes up.

Give at most ${COURT_MAP_ITEMS_MAX} items. Do not invent courts you cannot see.`;

export async function getCourtMap(env: Env, e: Pick<EventRow, "location" | "address">): Promise<CourtMapLayout | null> {
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
  if (bytes.length > MAX_BYTES) throw badRequest("照片太大了，请重新拍一张");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw badRequest("照片格式不对，请重新拍一张");
}

/** Reads the photo into a layout for the page to show; nothing is saved until 保存. */
export async function readCourtMapPhoto(
  env: Env,
  e: EventRow,
  memberId: string,
  body: Record<string, unknown>,
): Promise<CourtMapLayout> {
  if (!aiEnabled(env)) throw badRequest("拍照识别还没有开通");
  checkJpeg(body.image);
  const ts = now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM queue_photos WHERE event_id = ? AND member_id = ? AND created_at > ?",
  )
    .bind(e.id, memberId, new Date(Date.parse(ts) - 3600_000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_HOUR) throw badRequest("拍照用得太频繁了，请稍后再试");
  await env.DB.prepare("INSERT INTO queue_photos (event_id, member_id, created_at) VALUES (?, ?, ?)")
    .bind(e.id, memberId, ts)
    .run();
  const raw = await askAi(
    env,
    "photo",
    { text: PROMPT, image: body.image as string, schema: SCHEMA, maxTokens: 32000 },
    { eventId: e.id },
  );
  if (raw === undefined) throw new HttpError(502, "photo_failed", "照片没有识别出来，请重拍一张");
  const layout = (raw as { found?: unknown }).found === false ? null : cleanLayout(raw);
  if (!layout) throw badRequest("照片上没有找到球场图，请对准场馆贴的平面图重拍一张");
  return layout;
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
export async function saveCourtMap(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  const layout = cleanLayout(body.layout);
  if (!layout) throw badRequest("球场图里至少要有一片场地");
  const place = courtMapPlace(e.location, e.address);
  const json = JSON.stringify(layout);
  const ts = now();
  // Saved again unchanged (修改 then 保存 at once): nothing to keep.
  const cur = await env.DB.prepare("SELECT layout FROM court_maps WHERE place = ?")
    .bind(place)
    .first<{ layout: string }>();
  if (cur?.layout === json) return;
  await env.DB.batch([
    ...keepOld(env, place, ts),
    env.DB.prepare(
      `INSERT INTO court_maps (place, venue, address, layout, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (place) DO UPDATE SET venue = excluded.venue, address = excluded.address,
         layout = excluded.layout, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(place, e.location.trim(), e.address.trim(), json, memberId, ts),
  ]);
}

/** 删除: the venue has no plan any more; the one removed is kept with 以前的图. */
export async function removeCourtMap(env: Env, e: EventRow) {
  const place = courtMapPlace(e.location, e.address);
  await env.DB.batch([
    ...keepOld(env, place, now()),
    env.DB.prepare("DELETE FROM court_maps WHERE place = ?").bind(place),
  ]);
}

/** 以前的图 of the event's venue, newest first, each ready to open in the editor and save again. */
export async function courtMapHistory(env: Env, e: EventRow): Promise<CourtMapOld[]> {
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
