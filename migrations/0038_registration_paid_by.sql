-- 带群友: a member brought by another member who pays for them. The brought member keeps their own
-- row (friend_index 0), so everything else treats them as signed up themselves; only the bill goes
-- to paid_by. NULL for everyone who signed up themselves and for name-only friends.
ALTER TABLE registrations ADD COLUMN paid_by TEXT REFERENCES members (id);
CREATE INDEX registrations_paid_by ON registrations (event_id, paid_by) WHERE paid_by IS NOT NULL;
