-- 自付费用 (Ke Li 2026-11-14, option B): money a member paid themselves for an event, outside what
-- the organizer billed (say the drop-in fee at the venue's door). Only that member ever sees it; it
-- adds to their own 我的花费 and nothing else.
-- Rollback-safe (scripts/rollback-safe-migrations.json): a new table the older code never reads.
CREATE TABLE IF NOT EXISTS extra_spend (
  member_id  TEXT NOT NULL REFERENCES members (id),
  event_id   INTEGER NOT NULL REFERENCES events (id),
  cents      INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, event_id)
);
