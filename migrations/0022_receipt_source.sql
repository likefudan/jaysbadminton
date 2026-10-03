-- Where a Venmo payment on a bill came from, so 撤销 can send it back to 待确认 exactly: the
-- 待确认 row it was linked from (inbound_id), and the note of an auto-matched email (note).
ALTER TABLE payment_receipts ADD COLUMN inbound_id INTEGER;
ALTER TABLE payment_receipts ADD COLUMN note TEXT;

-- Receipts linked before this: the 待确认 row is the one still linked to the same bill, by its
-- transaction, or else by amount (two same-amount payments pair up oldest first).
UPDATE payment_receipts SET inbound_id = (
  SELECT i.id FROM inbound_payments i
  WHERE i.venmo_txn_id = payment_receipts.venmo_txn_id AND i.state = 'linked' AND i.linked_payment_id = payment_receipts.payment_id
) WHERE method = 'venmo' AND venmo_txn_id IS NOT NULL;
CREATE TABLE _r AS SELECT id, payment_id, amount_cents,
  ROW_NUMBER() OVER (PARTITION BY payment_id, amount_cents ORDER BY id) AS n
FROM payment_receipts WHERE method = 'venmo' AND venmo_txn_id IS NULL;
CREATE TABLE _i AS SELECT id, linked_payment_id, amount_cents,
  ROW_NUMBER() OVER (PARTITION BY linked_payment_id, amount_cents ORDER BY id) AS n
FROM inbound_payments WHERE state = 'linked' AND venmo_txn_id IS NULL;
UPDATE payment_receipts SET inbound_id = (
  SELECT _i.id FROM _r JOIN _i ON _i.linked_payment_id = _r.payment_id AND _i.amount_cents = _r.amount_cents AND _i.n = _r.n
  WHERE _r.id = payment_receipts.id
) WHERE id IN (SELECT id FROM _r);
DROP TABLE _r;
DROP TABLE _i;
