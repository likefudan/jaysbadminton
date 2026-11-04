-- 报名截止时间 is optional (Ke Li 2026-11-04): an event made with it off has no deadline of its own,
-- so sign-up stays open until the event ends (or is closed or finalized first). Its deadline_at is
-- kept at the end time, so closing it then works as for any other event.
ALTER TABLE events ADD COLUMN no_deadline INTEGER NOT NULL DEFAULT 0;
