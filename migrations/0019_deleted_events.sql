-- 从数据库永久删除 keeps only the deleted event's date and code, so the code is never given to a
-- new event: a late Venmo payment for the deleted event then lands in 待确认 instead of on
-- somebody's bill for the new one.
CREATE TABLE deleted_events (
  id         INTEGER PRIMARY KEY,                 -- the deleted event's id
  code       TEXT NOT NULL,
  date       TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX deleted_events_date ON deleted_events (date);
