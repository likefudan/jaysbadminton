-- 球场排队: for halls where courts are taken by queuing on the hall's own computer. NULL keeps an
-- event as before; a number turns the feature on and is how long one round on a court lasts.
ALTER TABLE events ADD COLUMN queue_round_min INTEGER;

-- Hall accounts (username + password for the hall's sign-up form) that players bring and share with
-- everyone on the event. Anyone may add several (their own, a friend's); nothing is checked.
CREATE TABLE queue_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id),
  member_id  TEXT NOT NULL REFERENCES members (id),   -- who added it
  username   TEXT NOT NULL COLLATE NOCASE,
  password   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, username)
);

-- Courts we hold or queue for, entered by hand from the hall's screen. position 0 = playing now,
-- 1..3 = that group in the court's queue. minutes_left is the screen's Minutes Left for the group
-- on the court when entered_at was taken; the pages count down and estimate from there.
CREATE TABLE queue_courts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events (id),
  court        INTEGER NOT NULL,
  position     INTEGER NOT NULL,
  minutes_left INTEGER NOT NULL,
  accounts     TEXT NOT NULL,                          -- JSON array of the hall usernames in our group
  entered_at   TEXT NOT NULL,
  entered_by   TEXT NOT NULL REFERENCES members (id)
);
CREATE INDEX queue_courts_event ON queue_courts (event_id);
