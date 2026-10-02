ALTER TABLE members ADD COLUMN google_sub TEXT;
ALTER TABLE members ADD COLUMN google_email TEXT;
CREATE UNIQUE INDEX members_google_sub ON members (google_sub);

CREATE TABLE member_sessions (
  id_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX member_sessions_expiry ON member_sessions (expires_at);

CREATE TABLE oauth_states (
  id_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
