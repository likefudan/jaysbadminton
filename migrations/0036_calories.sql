-- 卡路里: a member's own active energy for an event, read from iPhone 「健康」 by a Shortcut. One
-- number per member and event, overwritten by 重新读取. Kept apart from registrations, which are
-- rewritten when a sign-up changes.
CREATE TABLE calories (
  event_id    INTEGER NOT NULL REFERENCES events (id),
  member_id   TEXT NOT NULL REFERENCES members (id),
  kcal        INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (event_id, member_id)
);

-- The one-time code the page hands the Shortcut to post the number with: one member, one event,
-- 15 minutes, used once. Only its hash is kept.
CREATE TABLE calorie_uploads (
  code_hash  TEXT NOT NULL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events (id),
  member_id  TEXT NOT NULL REFERENCES members (id),
  expires_at TEXT NOT NULL
);

-- 卡路里榜 on the home page: only members who chose to be on it.
ALTER TABLE members ADD COLUMN calorie_board INTEGER NOT NULL DEFAULT 0;
