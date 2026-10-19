-- Settlements saved from now on split each total exactly in cents; older ones rounded every share
-- up and keep doing so until their fees are saved again.
ALTER TABLE settlements ADD COLUMN exact_split INTEGER NOT NULL DEFAULT 0;
