-- 无需收款 (Ke Li 2026-11-04): venues where everyone pays at the door themselves and queues on the
-- venue's system. Such an event has no fees, bills or payments: it ends by hand or by itself one
-- hour after its end time and goes straight to history (status 'settled', finalized_at NULL).
ALTER TABLE events ADD COLUMN no_fee INTEGER NOT NULL DEFAULT 0;
-- 最近的场馆 remember it like 排队系统, so picking the venue again sets it the same way.
ALTER TABLE locations ADD COLUMN no_fee INTEGER NOT NULL DEFAULT 0;
