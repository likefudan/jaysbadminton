/**
 * 活跃 / 少来 / 不活跃 on the 成员 tab (Ke Li 2026-11-19): from the days since a member last came,
 * whatever window the numbers are for. Never came since joining: 不活跃 once they've been in the
 * group longer than ACTIVE_DAYS, 少来 before that (a newcomer who hasn't come yet).
 */
export const ACTIVE_DAYS = 30;
export const QUIET_DAYS = 90;

export type ActivityLevel = "active" | "quiet" | "inactive";

export function activityLevel(s: { daysSince: number | null; joinedDays: number }): ActivityLevel {
  if (s.daysSince === null) return s.joinedDays <= ACTIVE_DAYS ? "quiet" : "inactive";
  if (s.daysSince <= ACTIVE_DAYS) return "active";
  if (s.daysSince <= QUIET_DAYS) return "quiet";
  return "inactive";
}

/** 出勤率 as a whole percent, or null when nothing was held for them in the window. */
export const attendanceRate = (s: { attended: number; held: number }): number | null =>
  s.held > 0 ? Math.round((Math.min(s.attended, s.held) / s.held) * 100) : null;
