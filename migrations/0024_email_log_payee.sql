-- Whose Venmo account each logged email was for (组织者, card 10), so the weekly digest can count
-- each payee's emails. NULL is the Owner, as everywhere: older code (after a rollback) keeps
-- logging without it, and its rows count as the Owner's. Only adds a column, so rolling back past
-- this migration needs no restore.
ALTER TABLE email_log ADD COLUMN payee_id TEXT REFERENCES members (id);
