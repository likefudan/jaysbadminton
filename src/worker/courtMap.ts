import { type CourtMapLayout, cleanLayout, COURT_MAP_ITEMS_MAX } from "../shared/courtMap";
import { aiEnabled, askAi } from "./ai";
import { now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest, HttpError } from "./http";

/**
 * 球场图 (Ke Li 2026-11-15): one floor plan per venue, keyed by the venue's name as events carry it.
 * Read from a photo of the venue's posted court map by the 拍照登记 model; the photo is only sent
 * to the model, never kept (as with 拍照登记). Shown and set from the 球场排队 card.
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

Items:
- kind "court": each badminton court with a number; label is just the number, e.g. "17".
- kind "area": every other box on the plan, e.g. courts for other sports, a court with letters (e.g. "JR"), the front desk, sign-up stations, restrooms drawn as boxes; label is its text as printed, short ("" if none).
- kind "text": a free-standing label such as "BADMINTON COURTS" or "ENTRANCE", with the box it takes up.

Give at most ${COURT_MAP_ITEMS_MAX} items. Do not invent courts you cannot see.`;

export async function getCourtMap(env: Env, venue: string): Promise<CourtMapLayout | null> {
  const row = await env.DB.prepare("SELECT layout FROM court_maps WHERE venue = ?")
    .bind(venue.trim())
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

/** 保存: the checked layout becomes the venue's plan, replacing an older one. */
export async function saveCourtMap(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  const layout = cleanLayout(body.layout);
  if (!layout) throw badRequest("球场图里至少要有一片场地");
  await env.DB.prepare(
    `INSERT INTO court_maps (venue, layout, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (venue) DO UPDATE SET layout = excluded.layout, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  )
    .bind(e.location.trim(), JSON.stringify(layout), memberId, now())
    .run();
}

export async function removeCourtMap(env: Env, e: EventRow) {
  await env.DB.prepare("DELETE FROM court_maps WHERE venue = ?").bind(e.location.trim()).run();
}
