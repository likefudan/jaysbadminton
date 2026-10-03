-- 活动编号 (jbm20261006, jbm20261006b): fixed when the event is created and never changed or given
-- to another event, so payment codes keep matching after the Owner edits the event's date.
-- Before this, codes were worked out from the event's current date, so editing it broke matching.

ALTER TABLE events ADD COLUMN number TEXT;
ALTER TABLE deleted_events ADD COLUMN number TEXT;

-- A finalized event takes the number its bills already carry, so codes members were given still match.
UPDATE events SET number = (
  SELECT lower(substr(substr(payment_code, instr(payment_code, '-jbm') + 1), 1,
    instr(substr(payment_code, instr(payment_code, '-jbm') + 1), '-') - 1))
  FROM payments WHERE payments.event_id = events.id AND instr(payment_code, '-jbm') > 0
  ORDER BY payments.id LIMIT 1
);
-- Every other event: its year and its code (the code is the creation date's month and day, plus a letter).
-- The year is the date's, one off when the date was moved across New Year (a December code on a
-- January date, or the other way round).
UPDATE events SET number = 'jbm' || (CAST(substr(date, 1, 4) AS INTEGER)
    + CASE WHEN CAST(substr(code, 1, 2) AS INTEGER) - CAST(substr(date, 6, 2) AS INTEGER) > 6 THEN -1
           WHEN CAST(substr(date, 6, 2) AS INTEGER) - CAST(substr(code, 1, 2) AS INTEGER) > 6 THEN 1 ELSE 0 END)
  || substr(code, 1, 4) || lower(substr(code, 5))
WHERE number IS NULL OR number NOT GLOB 'jbm[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*';
UPDATE deleted_events SET number = 'jbm' || (CAST(substr(date, 1, 4) AS INTEGER)
    + CASE WHEN CAST(substr(code, 1, 2) AS INTEGER) - CAST(substr(date, 6, 2) AS INTEGER) > 6 THEN -1
           WHEN CAST(substr(date, 6, 2) AS INTEGER) - CAST(substr(code, 1, 2) AS INTEGER) > 6 THEN 1 ELSE 0 END)
  || substr(code, 1, 4) || lower(substr(code, 5));

-- Earlier date edits could leave two events with the same number. The one whose bills carry it
-- keeps it (else the older one); each other one gets a letter counting back from z for that day,
-- below any late letter (n–z) the day already uses. Codes stay as they are, so links already
-- shared keep opening the same event.
CREATE TABLE _num AS
SELECT id, number,
  EXISTS (SELECT 1 FROM payments p WHERE p.event_id = e.id AND instr(lower(p.payment_code), '-' || e.number || '-') > 0) AS billed
FROM events e;
CREATE TABLE _dup AS
SELECT a.id, substr(a.number, 1, 11) AS day FROM _num a
WHERE EXISTS (SELECT 1 FROM _num b WHERE b.number = a.number AND b.id != a.id
  AND (b.billed > a.billed OR (b.billed = a.billed AND b.id < a.id)));
UPDATE events SET number = (
  SELECT d.day || char(
    unicode(COALESCE((SELECT MIN(substr(t.number, 12)) FROM _num t
      WHERE substr(t.number, 1, 11) = d.day AND length(t.number) = 12 AND substr(t.number, 12) >= 'n'), '{'))
    - (SELECT COUNT(*) FROM _dup o WHERE o.day = d.day AND o.id <= d.id))
  FROM _dup d WHERE d.id = events.id
) WHERE id IN (SELECT id FROM _dup);
DROP TABLE _dup;
DROP TABLE _num;

CREATE UNIQUE INDEX events_number ON events (number);
-- Deleted events only need finding by number; new events check both tables before taking one.
CREATE INDEX deleted_events_number ON deleted_events (number);
