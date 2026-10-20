-- 正式版发布通知: after each production release, CI records the version and the changes it carries
-- (the merged PR titles since the last announced release); the Worker then tells the Owner and
-- every admin in Telegram, once each (src/worker/releaseNotice.ts).
CREATE TABLE release_notices (
  tag           TEXT NOT NULL PRIMARY KEY,
  changes       TEXT NOT NULL,             -- JSON array of strings, Simplified Chinese as in the PR titles
  created_at    TEXT NOT NULL,
  lines         TEXT,                      -- JSON: the lines per language, written once (by Claude)
  delivered     TEXT NOT NULL DEFAULT '[]', -- JSON array of the chat ids that got it
  attempts      INTEGER NOT NULL DEFAULT 0, -- sending runs so far; at most 3
  claimed_until TEXT,                      -- a run is sending it until then
  sent_at       TEXT                       -- done: everyone got it, or it was given up
);
