-- Initial schema. Money is integer cents; times are UTC ISO-8601 strings.

CREATE TABLE members (
  id              TEXT PRIMARY KEY,               -- M001, M002, ... never reused
  username        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  wechat_nickname TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'active', 'inactive')),
  token_hash      TEXT UNIQUE,                     -- SHA-256 of the member link token
  token_enc       TEXT,                            -- token encrypted with TOKEN_KEY, so the Owner can view the link again
  is_owner        INTEGER NOT NULL DEFAULT 0,
  requested_at    TEXT NOT NULL,
  approved_at     TEXT
);

CREATE TABLE events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL,               -- 1006, 1006B
  date                TEXT NOT NULL,               -- Pacific calendar date, YYYY-MM-DD
  start_at            TEXT NOT NULL,
  end_at              TEXT NOT NULL,
  location            TEXT NOT NULL,
  deadline_at         TEXT NOT NULL,
  deadline_offset_min INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('open', 'closed', 'finalized', 'settled', 'cancelled')),
  finalized_at        TEXT,
  settled_at          TEXT,
  dunning_stopped     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);
CREATE INDEX events_status ON events (status);
CREATE INDEX events_code ON events (code);

CREATE TABLE registrations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events (id),
  member_id      TEXT NOT NULL REFERENCES members (id),
  friend_index   INTEGER NOT NULL DEFAULT 0,       -- 0 = the member, 1..N = their friends
  friend_name    TEXT,
  attended       INTEGER NOT NULL DEFAULT 1,
  added_by_owner INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (event_id, member_id, friend_index)
);

CREATE TABLE settlements (
  event_id            INTEGER PRIMARY KEY REFERENCES events (id),
  court_total_cents   INTEGER NOT NULL,
  shuttle_count       INTEGER NOT NULL,
  shuttle_price_cents INTEGER NOT NULL,
  registered_count    INTEGER NOT NULL,
  attended_count      INTEGER NOT NULL,
  court_share_cents   INTEGER NOT NULL,
  shuttle_share_cents INTEGER NOT NULL,
  finalized_at        TEXT
);

CREATE TABLE payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL REFERENCES events (id),
  member_id         TEXT NOT NULL REFERENCES members (id),
  amount_due_cents  INTEGER NOT NULL,
  payment_code      TEXT NOT NULL,                 -- BM1006-M007
  status            TEXT NOT NULL CHECK (status IN ('unpaid', 'paid', 'anomaly')),
  method            TEXT CHECK (method IN ('venmo_auto', 'manual')),
  amount_paid_cents INTEGER,
  paid_at           TEXT,
  venmo_txn_id      TEXT,
  email_id          TEXT,
  UNIQUE (event_id, member_id)
);
CREATE INDEX payments_code ON payments (payment_code);

CREATE TABLE inbound_payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  venmo_txn_id      TEXT UNIQUE,
  email_id          TEXT,
  payer_name        TEXT,
  amount_cents      INTEGER,
  note              TEXT,
  received_at       TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('unmatched', 'anomaly', 'other', 'parse_failed')),
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'linked', 'ignored')),
  linked_payment_id INTEGER REFERENCES payments (id),
  raw_text          TEXT
);

CREATE TABLE locations (
  name         TEXT PRIMARY KEY,
  last_used_at TEXT NOT NULL,
  use_count    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE notification_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER,
  type     TEXT NOT NULL,
  sent_on  TEXT NOT NULL,                          -- dedupe key: Pacific date, or date + hour for hourly jobs
  sent_at  TEXT NOT NULL,
  UNIQUE (event_id, type, sent_on)
);
