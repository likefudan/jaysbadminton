-- 预定场地: the hall's court numbers booked for the event, as a JSON array of numbers (e.g. [3,5]).
-- Whoever runs the event sets them any time before Finalize; players see them on the event card
-- and in the push 10 minutes before the start.
ALTER TABLE events ADD COLUMN booked_courts TEXT NOT NULL DEFAULT '[]';
