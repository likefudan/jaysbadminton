-- 拍照登记: photos of the hall's queue screen sent to be read, kept 7 days (Ke Li) so a wrong
-- reading can be checked, then removed by the cron job. result is what was read (JSON), NULL if
-- reading failed.
CREATE TABLE queue_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id),
  member_id  TEXT NOT NULL REFERENCES members (id),   -- who sent it
  image      BLOB NOT NULL,                            -- JPEG, shrunk on the phone first
  result     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX queue_photos_member ON queue_photos (event_id, member_id, created_at);
CREATE INDEX queue_photos_created ON queue_photos (created_at);
