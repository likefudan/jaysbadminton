-- 群操作记录 (docs/design/admin-role.zh.md §7): who did what to the group (members, appointments,
-- global settings, exports, transfers). Older code never reads or writes it.
CREATE TABLE group_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  target_id TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX group_audit_at ON group_audit (at);
