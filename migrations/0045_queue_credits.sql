-- 排队功臣 (2026-11-10): who put in each 球馆账号 and each court entry. The queue itself is purged a
-- few hours after the event, so the board counts from here instead. Backfilled from what is left.
CREATE TABLE queue_credits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id),
  member_id  TEXT NOT NULL REFERENCES members (id),
  kind       TEXT NOT NULL CHECK (kind IN ('account', 'court')),
  created_at TEXT NOT NULL
);
CREATE INDEX queue_credits_event ON queue_credits (event_id);

INSERT INTO queue_credits (event_id, member_id, kind, created_at)
  SELECT event_id, member_id, 'account', created_at FROM queue_accounts;
INSERT INTO queue_credits (event_id, member_id, kind, created_at)
  SELECT event_id, created_by, 'court', created_at FROM queue_courts;
