-- 在场时间 (Ke Li 2026-11-06): when a member says they arrive (到) and leave (走), Pacific HH:MM.
-- Both optional; set on the member's own row (friend_index 0); friends go with them.
ALTER TABLE registrations ADD COLUMN arrive_at TEXT;
ALTER TABLE registrations ADD COLUMN leave_at TEXT;
