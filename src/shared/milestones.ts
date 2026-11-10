/**
 * 里程碑 (Ke Li 2026-11-10, lowered the same day): each badge has three levels, bronze, silver and gold, reached at these
 * all-time totals. The page and the share image read the same list.
 */
export const MILESTONES = [
  { key: "attendance", tiers: [5, 20, 50] },
  { key: "hours", tiers: [10, 40, 100] },
  { key: "streak", tiers: [3, 6, 12] },
  { key: "early", tiers: [3, 10, 25] },
  { key: "friends", tiers: [3, 10, 25] },
  { key: "queue", tiers: [5, 20, 80] },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]["key"];

/** 0 for none yet, 1 bronze, 2 silver, 3 gold. */
export const tierOf = (tiers: readonly number[], value: number) => tiers.filter((t) => value >= t).length;
