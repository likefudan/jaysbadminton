-- 抽奖: members taken off the list by hand (Ke Li 2026-11-16: 抽奖名单可以允许 opt out 一些人，手动
-- 选择). They are among the first pool_size but don't take part; their place (rank) is kept here so
-- they can be put back on it. lottery_entries holds only those taking part, so the draw is unchanged.
CREATE TABLE IF NOT EXISTS lottery_excluded (
  lottery_id INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  PRIMARY KEY (lottery_id, rank)
);
