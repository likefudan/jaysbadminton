-- Why a forwarded Venmo payment needs the Owner's review (shown in the 待确认 list).
ALTER TABLE inbound_payments ADD COLUMN reason TEXT;
