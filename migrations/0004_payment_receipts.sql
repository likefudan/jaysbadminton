-- A bill can now be paid in several pieces: every Venmo or manual payment is a receipt, and the
-- bill's status follows the total received (unpaid / partial / paid; over-payments are refunded).
-- The payments table is rebuilt to change its status values. Nothing references it while it is
-- dropped, so no foreign key is ever violated, even for a moment.

CREATE TABLE _old_payments AS SELECT * FROM payments;
CREATE TABLE _inbound_links AS SELECT id, linked_payment_id FROM inbound_payments WHERE linked_payment_id IS NOT NULL;
UPDATE inbound_payments SET linked_payment_id = NULL WHERE linked_payment_id IS NOT NULL;

DROP TABLE payments;
CREATE TABLE payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL REFERENCES events (id),
  member_id         TEXT NOT NULL REFERENCES members (id),
  amount_due_cents  INTEGER NOT NULL,
  payment_code      TEXT NOT NULL,               -- xiaoming-jbm20261006-m007, fixed when the bill is created
  status            TEXT NOT NULL CHECK (status IN ('unpaid', 'partial', 'paid')),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,  -- sum of receipts
  refunded_cents    INTEGER NOT NULL DEFAULT 0,  -- over-payment the Owner has sent back
  paid_at           TEXT,                        -- when the total first reached the amount due
  UNIQUE (event_id, member_id)
);
CREATE INDEX payments_code ON payments (payment_code);

CREATE TABLE payment_receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   INTEGER NOT NULL REFERENCES payments (id),
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('venmo', 'manual')),
  venmo_txn_id TEXT UNIQUE,
  payer_name   TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX payment_receipts_payment ON payment_receipts (payment_id);

INSERT INTO payments (id, event_id, member_id, amount_due_cents, payment_code, status, amount_paid_cents, paid_at)
SELECT id, event_id, member_id, amount_due_cents, payment_code,
       CASE WHEN received >= amount_due_cents THEN 'paid' WHEN received > 0 THEN 'partial' ELSE 'unpaid' END,
       received,
       CASE WHEN received >= amount_due_cents THEN paid_at END
FROM (SELECT *, CASE status WHEN 'paid' THEN COALESCE(amount_paid_cents, amount_due_cents)
                            WHEN 'anomaly' THEN COALESCE(amount_paid_cents, 0) ELSE 0 END AS received
      FROM _old_payments);

INSERT INTO payment_receipts (payment_id, amount_cents, method, venmo_txn_id, received_at)
SELECT id, amount_paid_cents, CASE WHEN o.method = 'venmo_auto' THEN 'venmo' ELSE 'manual' END, o.venmo_txn_id,
       COALESCE(o.paid_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM payments JOIN (SELECT id AS oid, method, venmo_txn_id, paid_at FROM _old_payments) o ON o.oid = payments.id
WHERE amount_paid_cents > 0;

UPDATE inbound_payments SET linked_payment_id = (SELECT linked_payment_id FROM _inbound_links l WHERE l.id = inbound_payments.id)
WHERE id IN (SELECT id FROM _inbound_links);

DROP TABLE _old_payments;
DROP TABLE _inbound_links;
