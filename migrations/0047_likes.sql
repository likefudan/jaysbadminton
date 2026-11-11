-- 点赞 (Ke Li 2026-11-11): after an event, each member who played may like up to 3 others who
-- played too, one like each; the 点赞 board counts the likes received. Anonymous: nobody is shown
-- who liked whom, only how many likes they got.
CREATE TABLE likes (
  event_id    INTEGER NOT NULL REFERENCES events (id),
  from_member TEXT NOT NULL REFERENCES members (id),
  to_member   TEXT NOT NULL REFERENCES members (id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, from_member, to_member)
);
CREATE INDEX likes_to ON likes (to_member);

-- Ke Li wants likes on the board: it goes public where boards were already picked (one can turn it
-- off in 设置 → 排行榜); where every board was turned off, it stays off too.
UPDATE settings SET value = value || ',likes' WHERE key = 'leaderboard_boards' AND value != '';
