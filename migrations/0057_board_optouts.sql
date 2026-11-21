-- 排行榜参加开关 (Ke Li 2026-11-21): the boards a member took themselves off. Everyone is on every
-- board but 能量 unless a row here says otherwise; 能量 stays members.calorie_board (opt-in, as it
-- comes from 「健康」), and the switch for it is the same one.
CREATE TABLE IF NOT EXISTS board_optouts (
  member_id TEXT NOT NULL,
  board     TEXT NOT NULL,
  PRIMARY KEY (member_id, board)
);
