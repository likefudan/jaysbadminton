-- Opt-in troubleshooting only; separate from the accounting ledger and regular email log.
-- Purged after 14 days, including while diagnostics is disabled.
CREATE TABLE payment_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  txn_id TEXT,
  payer_name TEXT,
  note TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX payment_diagnostics_received ON payment_diagnostics (received_at, id);
