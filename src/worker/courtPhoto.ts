import Anthropic from "@anthropic-ai/sdk";
import {
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_MINUTES_MAX,
  type PhotoCourt,
  type PhotoResult,
} from "../shared/courtQueue";
import { now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest, HttpError } from "./http";

/**
 * 拍照登记: a photo of the hall's queue screen is read by Claude, which picks out the courts where
 * our shared accounts are playing or queued. The result fills the 登记球场 form for the player to
 * check; nothing is saved as a court until they do. It can mistake a look-alike name for ours, so
 * each account says whether it was sure and the form marks the unsure ones.
 *
 * Fable 5.1 on Ke Li's Azure (Microsoft Foundry) goes first: on her photos of 2026-10-24 it found
 * every one of our accounts in 6 of 6 reads, where Sonnet 5.5 missed some every time; it takes about
 * 10 seconds and 8 cents a photo (Ke Li, 2026-10-26). Sonnet 5.5 on the Anthropic API (2-4 seconds,
 * about a cent) is kept as the fallback when Azure fails or has no key.
 */
const AZURE_BASE_URL = "https://happy-badminton-jay-main-1.services.ai.azure.com/anthropic";

interface Reader {
  name: string;
  client: Anthropic;
  model: string;
}

/** The readers to try in order, each only when its key is set. */
const readers = (env: Env): Reader[] => [
  ...(env.AZURE_ANTHROPIC_API_KEY
    ? [
        {
          name: "azure",
          // Same Messages API as Anthropic's; Foundry takes the key in x-api-key too. No retry here:
          // the fallback is the retry.
          client: new Anthropic({
            apiKey: env.AZURE_ANTHROPIC_API_KEY,
            baseURL: AZURE_BASE_URL,
            timeout: 45_000,
            maxRetries: 0,
          }),
          model: "claude-fable-5-1",
        },
      ]
    : []),
  ...(env.ANTHROPIC_API_KEY
    ? [
        {
          name: "anthropic",
          client: new Anthropic({
            apiKey: env.ANTHROPIC_API_KEY,
            timeout: 60_000,
            maxRetries: 1,
          }),
          model: "claude-sonnet-5-5",
        },
      ]
    : []),
];

/** Kept this long so a wrong reading can be looked at, then removed by the cron job (Ke Li). */
const KEEP_MS = 7 * 24 * 3600_000;
/** The phone sends about 300 KB; this only stops a stray full-size photo. */
const MAX_BYTES = 2_000_000;
/** Per player per event per hour: a bad loop or a stuck button can't run up the bill. */
const PER_HOUR = 20;

export const photoEnabled = (env: Env) => !!(env.AZURE_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY);

const SCHEMA = {
  type: "object",
  properties: {
    ours: {
      type: "array",
      items: {
        type: "object",
        properties: {
          court: { type: "integer" },
          minutes_left: { anyOf: [{ type: "integer" }, { type: "null" }] },
          status: { type: "string", enum: ["playing", "queue"] },
          queue_position: { anyOf: [{ type: "integer" }, { type: "null" }] },
          accounts: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, uncertain: { type: "boolean" } },
              required: ["name", "uncertain"],
              additionalProperties: false,
            },
          },
        },
        required: ["court", "minutes_left", "status", "queue_position", "accounts"],
        additionalProperties: false,
      },
    },
    unreadable_courts: { type: "array", items: { type: "integer" } },
  },
  required: ["ours", "unreadable_courts"],
  additionalProperties: false,
};

const prompt = (
  accounts: string[],
) => `This is a phone photo of a badminton hall's court-queue screen. Each court box shows "Court N", a "Minutes Left" number, a "Current Players" row with 1-4 usernames separated by " - ", and up to 3 numbered queue rows under "Queue:", each a group of 1-4 usernames.

Our group's hall accounts are: ${accounts.join(", ")}.
List only the courts where one of our accounts appears, playing or in a queue row. A name counts only if it is spelled exactly like our account letter by letter; similar-looking names belong to other people. Give the court's minutes_left, queue_position (the queue row number, null when playing) and our accounts on that row, each with uncertain set to true if you cannot read that name clearly. Put courts that are cut off or unreadable into unreadable_courts. Do not invent anything you cannot see.`;

interface Raw {
  ours: {
    court: number;
    minutes_left: number | null;
    status: "playing" | "queue";
    queue_position: number | null;
    accounts: { name: string; uncertain: boolean }[];
  }[];
  unreadable_courts: number[];
}

const whole = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/**
 * The model's answer as form entries: only accounts shared on the event (spelled as they were
 * added), at most a group's worth per entry, one entry per court and position, nothing out of range.
 */
export function toPhotoResult(raw: unknown, accounts: string[]): PhotoResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Raw>;
  const known = new Map(accounts.map((a) => [a.toLowerCase(), a]));
  const byKey = new Map<string, PhotoCourt>();
  for (const o of Array.isArray(r.ours) ? r.ours : []) {
    const court = whole(o?.court, 1, QUEUE_COURT_MAX);
    if (court === null) continue;
    const position = o.status === "playing" ? 0 : whole(o.queue_position, 1, QUEUE_MAX_POSITION);
    if (position === null) continue;
    const key = `${court}:${position}`;
    const entry = byKey.get(key) ?? {
      court,
      position,
      minutesLeft: whole(o.minutes_left, 0, QUEUE_MINUTES_MAX),
      accounts: [],
    };
    for (const a of Array.isArray(o.accounts) ? o.accounts : []) {
      const username = typeof a?.name === "string" ? known.get(a.name.trim().toLowerCase()) : undefined;
      if (!username || entry.accounts.length >= QUEUE_GROUP_MAX) continue;
      if (entry.accounts.some((x) => x.username === username)) continue;
      entry.accounts.push({ username, uncertain: a.uncertain === true });
    }
    if (entry.accounts.length > 0) byKey.set(key, entry);
  }
  const unreadable = [
    ...new Set(
      (Array.isArray(r.unreadable_courts) ? r.unreadable_courts : [])
        .map((n) => whole(n, 1, QUEUE_COURT_MAX))
        .filter((n): n is number => n !== null),
    ),
  ].sort((a, b) => a - b);
  return {
    courts: [...byKey.values()].sort((a, b) => a.court - b.court || a.position - b.position),
    unreadable,
  };
}

function jpeg(v: unknown): Uint8Array {
  if (typeof v !== "string" || !v) throw badRequest("请选择一张照片");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  } catch {
    throw badRequest("照片格式不对，请重新拍一张");
  }
  if (bytes.length > MAX_BYTES) throw badRequest("照片太大了，请重新拍一张");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw badRequest("照片格式不对，请重新拍一张");
  return bytes;
}

const failed = () => new HttpError(502, "photo_failed", "照片没有识别出来，请重拍一张或手动填写");

/** One reader's answer, or undefined when it failed (logged). */
async function read(reader: Reader, image: string, accounts: string[]): Promise<unknown> {
  try {
    const response = await reader.client.messages.create({
      model: reader.model,
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: image },
            },
            { type: "text", text: prompt(accounts) },
          ],
        },
      ],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
    });
    if (response.stop_reason !== "end_turn") {
      console.error(`court photo (${reader.name}): stopped with ${response.stop_reason}`);
      return undefined;
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text);
  } catch (err) {
    console.error(
      `court photo (${reader.name}):`,
      err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err,
    );
    return undefined;
  }
}

/** 拍照登记: read the photo and return the courts with our accounts, for the form to fill in. */
export async function readCourtPhoto(env: Env, e: EventRow, memberId: string, body: Record<string, unknown>) {
  if (!photoEnabled(env)) throw badRequest("拍照登记还没有开通，请手动填写");
  const image = jpeg(body.image);
  const { results } = await env.DB.prepare("SELECT username FROM queue_accounts WHERE event_id = ? ORDER BY id")
    .bind(e.id)
    .all<{ username: string }>();
  const accounts = results.map((r) => r.username);
  if (accounts.length === 0) throw badRequest("还没有人添加球馆账号，请先在「球馆账号」里添加");
  const ts = now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM queue_photos WHERE event_id = ? AND member_id = ? AND created_at > ?",
  )
    .bind(e.id, memberId, new Date(Date.parse(ts) - 3600_000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_HOUR) throw badRequest("拍照登记用得太频繁了，请稍后再试或手动填写");
  const saved = await env.DB.prepare(
    "INSERT INTO queue_photos (event_id, member_id, image, created_at) VALUES (?, ?, ?, ?) RETURNING id",
  )
    .bind(e.id, memberId, image, ts)
    .first<{ id: number }>();

  let raw: unknown;
  for (const reader of readers(env)) {
    raw = await read(reader, body.image as string, accounts);
    if (raw !== undefined) break;
  }
  if (raw === undefined) throw failed();
  const result = toPhotoResult(raw, accounts);
  await env.DB.prepare("UPDATE queue_photos SET result = ? WHERE id = ?").bind(JSON.stringify(result), saved!.id).run();
  return result;
}

/** Cron: photos go after 7 days. */
export async function purgeCourtPhotos(env: Env, at = new Date()) {
  await env.DB.prepare("DELETE FROM queue_photos WHERE created_at < ?")
    .bind(new Date(at.getTime() - KEEP_MS).toISOString())
    .run();
}
