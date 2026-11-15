-- 球场图拍照 (Ke Li 2026-11-15: 每个球场每月只能拍10张，每人每月也只能拍10张，避免滥用): one row
-- per photo sent to the model to draw a venue's plan, whether or not it could be read. month is
-- the Pacific calendar month (YYYY-MM) the limits count in. member_id is who sent it (a member id,
-- or 'owner' before the Owner has one), without a foreign key as in court_maps. request is the
-- call's id in ai_usage; cost is its estimated price in US$, null when the model has no price.
CREATE TABLE court_map_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  place      TEXT NOT NULL,
  venue      TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  month      TEXT NOT NULL,
  request    TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  cost       REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX court_map_photos_place ON court_map_photos (month, place);
CREATE INDEX court_map_photos_member ON court_map_photos (month, member_id);
