-- payments.amount_paid_cents is now what was received net of refunds, so a bill that goes back up
-- after a refund shows the balance due instead of staying paid.
UPDATE payments SET amount_paid_cents = amount_paid_cents - refunded_cents WHERE refunded_cents > 0;
