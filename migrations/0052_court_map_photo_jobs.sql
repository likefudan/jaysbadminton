-- 球场图拍照在后台识别 (Ke Li 2026-11-15: 拍了之后可以返回其他页面，过一会儿回来看结果): a photo row
-- is now also the job. state: 'pending' (waiting for the model, or with it since started_at),
-- 'ready' (layout is the plan read, waiting to be looked at and saved), 'none' (no court map on the
-- photo), 'failed', and 'done' once someone has saved, dropped or replaced the result. Rows from
-- before are 'done'. image is the photo itself (base64 JPEG) only until the model has answered;
-- layout only until the result is saved or dropped. address is the venue's as typed, to list a
-- venue that is waiting but no longer among 最近的场馆.
ALTER TABLE court_map_photos ADD COLUMN state TEXT NOT NULL DEFAULT 'done';
ALTER TABLE court_map_photos ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE court_map_photos ADD COLUMN image TEXT;
ALTER TABLE court_map_photos ADD COLUMN layout TEXT;
ALTER TABLE court_map_photos ADD COLUMN started_at TEXT;
ALTER TABLE court_map_photos ADD COLUMN finished_at TEXT;
