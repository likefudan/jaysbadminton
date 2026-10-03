-- 已删除: a 待确认 or ignored Venmo payment can be moved to the trash. It keeps the state it came
-- from (to restore it) and when it was deleted; the cron removes it for good after 30 days.
-- The table is rebuilt to change its CHECK; nothing references it.

CREATE TABLE _old_inbound AS SELECT * FROM inbound_payments;
DROP TABLE inbound_payments;
CREATE TABLE inbound_payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  venmo_txn_id      TEXT UNIQUE,
  email_id          TEXT,
  payer_name        TEXT,
  amount_cents      INTEGER,
  note              TEXT,
  received_at       TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('unmatched', 'anomaly', 'other', 'parse_failed')),
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'linked', 'ignored', 'deleted')),
  linked_payment_id INTEGER REFERENCES payments (id),
  raw_text          TEXT,
  reason            TEXT,
  deleted_from      TEXT CHECK (deleted_from IN ('open', 'ignored')), -- the state to restore
  deleted_at        TEXT
);
INSERT INTO inbound_payments (id, venmo_txn_id, email_id, payer_name, amount_cents, note, received_at, kind, state, linked_payment_id, raw_text, reason)
SELECT id, venmo_txn_id, email_id, payer_name, amount_cents, note, received_at, kind, state, linked_payment_id, raw_text, reason FROM _old_inbound;
DROP TABLE _old_inbound;
