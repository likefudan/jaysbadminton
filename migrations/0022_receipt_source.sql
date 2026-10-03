-- Where a Venmo payment on a bill came from, so 撤销 can send it back to 待确认 exactly: the
-- 待确认 row it was linked from (inbound_id), and the note of an auto-matched email (note).
-- Older linked receipts are found by their transaction instead.
ALTER TABLE payment_receipts ADD COLUMN inbound_id INTEGER;
ALTER TABLE payment_receipts ADD COLUMN note TEXT;

