-- 我的活动 and 个人统计 look up one member's sign-ups and bills; the existing unique keys lead with
-- event_id, so those lookups scanned the whole table.
CREATE INDEX IF NOT EXISTS registrations_member ON registrations (member_id);
CREATE INDEX IF NOT EXISTS payments_member ON payments (member_id);
