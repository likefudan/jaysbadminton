-- 抽奖 (Ke Li 2026-11-16, 百人庆祝抽奖, option C 百人头像墙): the first pool_size members by when they were let
-- into the group take part; prizes (JSON [{name, count}]) are drawn in that order, one winner a draw.
-- status: 'open' (published, the list locked, waiting for 开奖), 'drawn', 'cancelled'. seed decides the
-- winners (src/shared/lottery.ts drawWinners); only seed_hash is shown until the draw, then the seed
-- too, so anyone can check the result. draw_at is the time announced, when it draws by itself (Ke Li:
-- 倒计时自动开始); drawn_at is recorded as that time by the first to look after it. reminded / announced:
-- whether the notices before and after went out. hidden_at: taken off 我的活动 after the draw. locked: the
-- Owner locked it (Ke Li 2026-11-16): nobody can change or cancel it until the Owner unlocks it; it
-- still draws on time. Member ids without foreign keys, so 清空所有数据 and member removal never trip on
-- them.
CREATE TABLE IF NOT EXISTS lotteries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  pool_size   INTEGER NOT NULL,
  prizes      TEXT NOT NULL,
  draw_at     TEXT NOT NULL,
  next_goal   INTEGER,
  status      TEXT NOT NULL,
  seed        TEXT NOT NULL,
  seed_hash   TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  drawn_at    TEXT,
  drawn_by    TEXT,
  reminded    INTEGER NOT NULL DEFAULT 0,
  announced   INTEGER NOT NULL DEFAULT 0,
  hidden_at   TEXT,
  locked      INTEGER NOT NULL DEFAULT 0
);

-- The locked list: rank 1 is the first member let in.
CREATE TABLE IF NOT EXISTS lottery_entries (
  lottery_id INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  PRIMARY KEY (lottery_id, rank)
);

-- One row per draw (draw_no from 1), the prize it was for.
CREATE TABLE IF NOT EXISTS lottery_winners (
  lottery_id INTEGER NOT NULL,
  draw_no    INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  prize      TEXT NOT NULL,
  PRIMARY KEY (lottery_id, draw_no)
);

-- Who has the page open (seen_at, for 在看 and the grey faces) and how often they tapped 打气.
CREATE TABLE IF NOT EXISTS lottery_watchers (
  lottery_id INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  seen_at    TEXT NOT NULL,
  cheers     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lottery_id, member_id)
);
