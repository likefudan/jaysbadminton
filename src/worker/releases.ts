import type { ReleaseEntry, ReleasesResponse } from "../shared/types";
import type { Env } from "./env";

/**
 * 版本和更新记录 (Ke Li 2026-11-13, option A): 设置 shows the Owner, admins and organizers which
 * version this site runs and what each release changed. Both come from this site alone: the version
 * CI deployed (APP_VERSION) and the releases CI recorded here for the Telegram notice
 * (release_notices, scripts/release-notice.mjs), with the plain lines Claude wrote for it in each
 * language once it was sent. A release not sent yet, or written without a model, shows the merged
 * PR titles instead. Only releases newer than any before reach the table, so a rollback or a
 * redeploy adds nothing; the table starts at migration 0035 (2026-10-20).
 */

/** More than a year of releases at a few a day; older ones aren't worth the bytes. */
const MAX_RELEASES = 300;

const TAG_RE = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** Release tags in order: v2026.11.09 < v2026.11.09.2 < v2026.11.10 (as scripts/release-notice.mjs). */
const parts = (t: string) => [...t.slice(1).split(".").map(Number), 1].slice(0, 4);
export function compareTags(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const list = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : null;

function parse(json: string | null): unknown {
  try {
    return JSON.parse(json ?? "null");
  } catch {
    return null;
  }
}

export async function listReleases(env: Env): Promise<ReleasesResponse> {
  const { results } = await env.DB.prepare("SELECT tag, changes, created_at, lines FROM release_notices").all<{
    tag: string;
    changes: string;
    created_at: string;
    lines: string | null;
  }>();
  const releases = results
    .filter((r) => TAG_RE.test(r.tag))
    .sort((a, b) => compareTags(b.tag, a.tag))
    .slice(0, MAX_RELEASES)
    .map((r): ReleaseEntry => {
      const changes = list(parse(r.changes)) ?? [];
      const l = parse(r.lines) as Record<string, unknown> | null;
      const zh = l && list(l["zh-CN"]);
      const tw = l && list(l["zh-TW"]);
      const en = l && list(l.en);
      // Without a model the notice carried the bare titles in every language (maybe cut short):
      // those show as the full list of changes instead.
      const bare = !!zh && zh.length > 0 && JSON.stringify(zh) === JSON.stringify(en);
      const lines = zh && tw && en && !bare ? { "zh-CN": zh, "zh-TW": tw, en } : null;
      return { tag: r.tag, at: r.created_at, lines, changes: lines ? [] : changes };
    });
  return { current: env.APP_VERSION || null, releases };
}
