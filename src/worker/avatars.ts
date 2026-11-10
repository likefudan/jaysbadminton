import type { AvatarMode } from "../shared/types";
import { now } from "./db";
import type { Env } from "./env";
import { badRequest } from "./http";
import { randomToken } from "./lib/crypto";
import type { MemberRow } from "./members";

/**
 * 头像 (Ke Li 2026-11-10): shown on the 排行榜, in 年度回顾's 最常一起打球 and on 个人信息. A member's
 * own photo if they uploaded one, else the picture of the Google account they sign in with, else
 * none (the page draws an empty one). They can also choose none on purpose.
 *
 * The phone crops the photo square and shrinks it to AVATAR_SIDE before sending (src/web/Avatar.tsx),
 * so one is about 10-20 KB; it lives in D1 like the queue photos, under a random id that changes on
 * every upload, so its URL is cached for good.
 */
export const AVATAR_MAX_BYTES = 150_000;

type AvatarFields = Pick<MemberRow, "avatar" | "google_picture">;

/** Where the page loads a member's avatar from, or null for the empty one. */
export function avatarUrl(m: AvatarFields): string | null {
  if (m.avatar === "none") return null;
  if (m.avatar) return `/api/public/avatars/${m.avatar}`;
  return m.google_picture;
}

export function avatarMode(m: AvatarFields): AvatarMode {
  return m.avatar === "none" ? "none" : m.avatar ? "own" : "google";
}

/** Every active member's avatar URL by member id, for lists of names (排行榜). */
export async function avatarsById(env: Env): Promise<Map<string, string | null>> {
  const { results } = await env.DB.prepare(
    "SELECT id, avatar, google_picture FROM members WHERE status = 'active'",
  ).all<AvatarFields & { id: string }>();
  return new Map(results.map((m) => [m.id, avatarUrl(m)]));
}

function jpeg(v: unknown): Uint8Array {
  if (typeof v !== "string" || !v) throw badRequest("请选择一张照片");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  } catch {
    throw badRequest("照片格式不对，请换一张");
  }
  if (bytes.length > AVATAR_MAX_BYTES) throw badRequest("照片太大了，请换一张");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw badRequest("照片格式不对，请换一张");
  return bytes;
}

/** A new photo replaces the old one (whose URL stops working). */
export async function uploadAvatar(env: Env, m: MemberRow, image: unknown): Promise<string> {
  const bytes = jpeg(image);
  const id = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(m.id),
    env.DB.prepare("INSERT INTO member_avatars (id, member_id, image, created_at) VALUES (?, ?, ?, ?)").bind(
      id,
      m.id,
      bytes,
      now(),
    ),
    env.DB.prepare("UPDATE members SET avatar = ? WHERE id = ?").bind(id, m.id),
  ]);
  return avatarUrl({ avatar: id, google_picture: null })!;
}

/** 用 Google 头像 or 不用头像: their own photo, if any, is deleted. */
export async function setAvatarMode(env: Env, m: MemberRow, mode: unknown): Promise<void> {
  if (mode !== "google" && mode !== "none") throw badRequest("请选择头像");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(m.id),
    env.DB.prepare("UPDATE members SET avatar = ? WHERE id = ?").bind(mode === "none" ? "none" : null, m.id),
  ]);
}

/** The photo itself; anyone with its (random) id may load it, like an image link. */
export async function readAvatar(env: Env, id: string): Promise<ArrayBuffer | null> {
  const row = await env.DB.prepare("SELECT image FROM member_avatars WHERE id = ?")
    .bind(id)
    .first<{ image: ArrayBuffer | number[] }>();
  return row ? new Uint8Array(row.image).buffer : null;
}

/** Deleting a member lets go of their pictures too. */
export const forgetAvatar = (db: D1Database, memberId: string) => [
  db.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(memberId),
  db.prepare("UPDATE members SET avatar = NULL, google_picture = NULL WHERE id = ?").bind(memberId),
];

/** Each Google sign-in brings the account's current picture (or none, if it has none). */
export const syncGooglePicture = (db: D1Database, googleSub: string, picture: string | null) =>
  db
    .prepare("UPDATE members SET google_picture = ? WHERE google_sub = ? AND deleted_at IS NULL")
    .bind(picture, googleSub);
