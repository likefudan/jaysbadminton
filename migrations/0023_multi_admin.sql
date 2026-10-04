-- 组织者 (docs/design/organizers.zh.md §5). Only adds columns and tables, so code from before this
-- migration still runs on the result. One exception: the older 清空所有数据 does not know the new
-- tables that point at members, so after a rollback it fails on their foreign keys once an
-- organizer has saved payment settings or Telegram (only possible with the flag on: staging, until
-- launch). The flag ORGANIZERS gates every way in; until it is on, nobody has role 'organizer' and
-- every event's manager and payee is the Owner.

-- Who a member is besides the Owner (is_owner stays: there is exactly one Owner). 'member' or
-- 'organizer' (a future 'admin' fits too). No CHECK: changing one in SQLite means rebuilding the
-- table, so the code checks the value.
ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE members ADD COLUMN role_since TEXT;

-- Each event's 负责人 (manager) and 收款人 (payee). NULL means the Owner everywhere in the code, so
-- events created by older code (after a rollback) still count as the Owner's.
ALTER TABLE events ADD COLUMN manager_id TEXT REFERENCES members (id);
ALTER TABLE events ADD COLUMN payee_id TEXT REFERENCES members (id);
UPDATE events SET manager_id = (SELECT id FROM members WHERE is_owner = 1),
                  payee_id = (SELECT id FROM members WHERE is_owner = 1);
CREATE INDEX events_manager ON events (manager_id);
CREATE INDEX events_payee ON events (payee_id);

-- Organizers' payment settings. The Owner's stay in settings (venmo_username etc.), so rolling
-- back loses nothing of theirs.
CREATE TABLE payment_profiles (
  member_id        TEXT NOT NULL PRIMARY KEY REFERENCES members (id),
  -- NULL when not filled in, never '' (UNIQUE would let only one person leave it blank).
  venmo_username   TEXT COLLATE NOCASE UNIQUE CHECK (venmo_username != ''),
  venmo_email      TEXT COLLATE NOCASE UNIQUE CHECK (venmo_email != ''),
  zelle_account    TEXT,
  email_last_at    TEXT,  -- the last Venmo email for this account (health check, 转发已生效)
  gmail_confirm    TEXT,  -- the last Gmail forwarding confirmation, shown for 24 hours
  gmail_confirm_at TEXT,
  retired_at       TEXT,  -- when they stopped being an organizer (历史收款人)
  updated_at       TEXT NOT NULL
);

-- A changed Venmo username / notification email keeps being recognized for 60 days.
CREATE TABLE payment_aliases (
  venmo_username TEXT COLLATE NOCASE NOT NULL,
  venmo_email    TEXT COLLATE NOCASE NOT NULL,
  member_id      TEXT NOT NULL REFERENCES members (id),
  until          TEXT NOT NULL,
  PRIMARY KEY (venmo_username, venmo_email)
);

-- Whose account a received payment went into. NULL means the Owner; every payment so far went to them.
ALTER TABLE inbound_payments ADD COLUMN payee_id TEXT REFERENCES members (id);
UPDATE inbound_payments SET payee_id = (SELECT id FROM members WHERE is_owner = 1);
CREATE INDEX inbound_payee ON inbound_payments (payee_id, state);

-- Organizers' Telegram chats. The Owner's stays in settings (telegram_chat_id).
CREATE TABLE telegram_bindings (
  member_id    TEXT NOT NULL PRIMARY KEY REFERENCES members (id),
  chat_id      TEXT UNIQUE,  -- NULL until connected (UNIQUE allows several NULLs)
  chat_name    TEXT,
  bind_hash    TEXT,         -- SHA-256 of their one-time 连接 Telegram code, cleared once connected
  bind_expires TEXT
);

-- 操作记录: who changed what in an event (the Owner too; auto-matching is 'system').
CREATE TABLE event_audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action   TEXT NOT NULL,  -- roster_add / fee_edit / mark_paid / refund / reassign ...
  detail   TEXT,
  at       TEXT NOT NULL
);
CREATE INDEX event_audit_event ON event_audit (event_id, at);
