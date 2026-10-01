-- One row per Venmo email the Worker handled (outcome only, no content), for the weekly digest
-- and the "forwarding went quiet" alert. Rows older than 120 days are pruned by the digest.
CREATE TABLE email_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  outcome     TEXT NOT NULL
);
CREATE INDEX email_log_received ON email_log (received_at);
