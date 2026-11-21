-- 比分 (Ke Li 2026-11-21): a player records a singles or doubles match at an event; lineups are
-- members on that event's list or 路人 (non-members, an optional name). The other side must have at
-- least one member, and every member on court other than the recorder must confirm before it counts;
-- one 「比分不对」 voids it. Unanswered after 3 days it lapses (worked out when read, no job).
CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events (id),
  recorded_by TEXT NOT NULL REFERENCES members (id),
  doubles     INTEGER NOT NULL,
  -- JSON [[a, b], ...]: each game, side A's points first (A is the recorder's side).
  games       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_event ON matches (event_id);

-- Who played: side 0 is the recorder's. A member (member_id) or a 路人 (member_id NULL, guest_name
-- optional). answer: NULL waiting, 'ok' confirmed, 'no' said the score is wrong; the recorder's own row is 'ok'.
CREATE TABLE IF NOT EXISTS match_players (
  match_id    INTEGER NOT NULL REFERENCES matches (id),
  side        INTEGER NOT NULL,
  slot        INTEGER NOT NULL,
  member_id   TEXT REFERENCES members (id),
  guest_name  TEXT,
  answer      TEXT,
  answered_at TEXT,
  PRIMARY KEY (match_id, side, slot)
);
CREATE INDEX IF NOT EXISTS match_players_member ON match_players (member_id);
