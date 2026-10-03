-- Refunds become their own records: a payment_receipts row with method 'refund' and a negative
-- amount, so every payment and every refund is listed separately. payments.amount_paid_cents is
-- now the net received (payments minus refunds) and refunded_cents the total refunded, both
-- derived from these rows; a bill counts as paid only when the net reaches the amount due.
-- The table is rebuilt to change its CHECK; nothing references it.

CREATE TABLE _old_receipts AS SELECT * FROM payment_receipts;
DROP TABLE payment_receipts;
CREATE TABLE payment_receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   INTEGER NOT NULL REFERENCES payments (id),
  amount_cents INTEGER NOT NULL,                -- negative for a refund
  method       TEXT NOT NULL CHECK (method IN ('venmo', 'manual', 'refund')),
  venmo_txn_id TEXT UNIQUE,
  payer_name   TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX payment_receipts_payment ON payment_receipts (payment_id);
INSERT INTO payment_receipts (id, payment_id, amount_cents, method, venmo_txn_id, payer_name, received_at)
SELECT id, payment_id, amount_cents, method, venmo_txn_id, payer_name, received_at FROM _old_receipts;
DROP TABLE _old_receipts;

INSERT INTO payment_receipts (payment_id, amount_cents, method, received_at)
SELECT id, -refunded_cents, 'refund', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM payments WHERE refunded_cents > 0;
UPDATE payments SET amount_paid_cents = amount_paid_cents - refunded_cents WHERE refunded_cents > 0;
