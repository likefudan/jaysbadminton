/**
 * 里程碑 (Ke Li 2026-11-10): each badge has three levels, bronze, silver and gold, reached at these
 * all-time totals. The page and the share image read the same list.
 */
export const MILESTONES = [
  { key: "attendance", tiers: [10, 50, 100] },
  { key: "hours", tiers: [20, 100, 300] },
  { key: "streak", tiers: [5, 10, 20] },
  { key: "early", tiers: [5, 20, 50] },
  { key: "friends", tiers: [5, 20, 50] },
  { key: "queue", tiers: [10, 50, 200] },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]["key"];

/** 0 for none yet, 1 bronze, 2 silver, 3 gold. */
export const tierOf = (tiers: readonly number[], value: number) => tiers.filter((t) => value >= t).length;
