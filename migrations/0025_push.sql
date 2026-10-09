-- 推送通知: a member's browsers that turned on push (Web Push), and the pushes waiting to go out.
-- One row per browser; a member can have several (phone and computer).
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,   -- the push service URL the browser gave us
  member_id  TEXT NOT NULL,
  p256dh     TEXT NOT NULL,      -- the browser's public key (base64url)
  auth       TEXT NOT NULL,      -- its auth secret (base64url)
  created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_member ON push_subscriptions (member_id);

-- Sent right away by the request that queued them; the cron sends whatever is left (or failed).
CREATE TABLE push_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL,
  member_id  TEXT NOT NULL,      -- whose it is: not sent if the browser has moved to someone else
  kind       TEXT NOT NULL,      -- event / bill / welcome: an event no longer open or a bill paid by
  event_id   INTEGER,            -- the time it goes out is not sent
  payload    TEXT NOT NULL,      -- JSON: title, body, url, tag
  created_at TEXT NOT NULL,
  claimed_at TEXT,               -- set by whoever is sending it; free again after a few minutes
  attempts   INTEGER NOT NULL DEFAULT 0   -- failed tries
);
