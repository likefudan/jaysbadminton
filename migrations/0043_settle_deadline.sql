-- 结算期限 (Ke Li 2026-11-05): an event that collects money but isn't finalized within this many
-- hours of its end goes to history by itself, with nothing billed (未结算). It cannot be reopened.
ALTER TABLE events ADD COLUMN unsettled INTEGER NOT NULL DEFAULT 0;
-- Events already over when this arrives get their hours from now, so nothing is archived the moment
-- it ships. Turning the setting back on later moves this too.
INSERT OR IGNORE INTO settings (key, value) VALUES ('settle_deadline_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
