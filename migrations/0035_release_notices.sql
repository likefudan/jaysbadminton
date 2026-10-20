-- 正式版发布通知: after each production release, CI records the version and the changes it carries
-- (the merged PR titles since the previous release); the Worker then tells the Owner and every
-- admin in Telegram, once. sent_at is set when the notice is claimed for sending.
CREATE TABLE release_notices (
  tag        TEXT NOT NULL PRIMARY KEY,
  changes    TEXT NOT NULL, -- JSON array of strings, Simplified Chinese as written in the PR titles
  created_at TEXT NOT NULL,
  sent_at    TEXT
);
