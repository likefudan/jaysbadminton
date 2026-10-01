-- Admin password sessions (card 2). Only the SHA-256 of each session cookie is stored.
CREATE TABLE admin_sessions (
  id_hash    TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Member IDs come from this counter so a rejected request's ID is never handed out again.
INSERT INTO settings (key, value) VALUES ('next_member_seq', '0');
