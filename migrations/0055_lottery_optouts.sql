-- 抽奖: members who took themselves off the list from the 抽奖 card (Ke Li 2026-11-16: 从抽奖活动卡片上
-- opt out). They are also in lottery_excluded, which keeps their number; this only marks that it was
-- their own choice, so they (and only they) can come back, until it is locked or drawn.
CREATE TABLE IF NOT EXISTS lottery_optouts (
  lottery_id INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  PRIMARY KEY (lottery_id, member_id)
);
