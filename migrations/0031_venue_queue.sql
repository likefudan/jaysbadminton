-- 最近的场馆 remember whether the venue needs 排队系统 (and its round length), so picking the
-- venue again sets it the same way. NULL: no queuing.
ALTER TABLE locations ADD COLUMN queue_round_min INTEGER;
