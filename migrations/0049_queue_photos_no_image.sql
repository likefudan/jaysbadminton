-- 拍照登记: the photo is no longer kept (Ke Li 2026-11-14). It is only sent to be read; the phone
-- keeps showing it until the courts are saved. This drops the photos stored so far. The rows stay
-- (who sent one, when, what was read) for the 20-an-hour limit and go after 7 days as before.
ALTER TABLE queue_photos DROP COLUMN image;
