-- 球场图 (Ke Li 2026-11-15): one floor plan per venue, read from a photo of the plan posted at the
-- venue and then fixed by hand. place says which venue (src/shared/courtMap.ts courtMapPlace): its
-- address, case, spaces and punctuation aside, or its name for a venue saved without an address.
-- venue and address are kept as they were typed, to show. layout is JSON. updated_by is a member
-- id, without a foreign key so 清空所有数据 and member removal never trip on it.
CREATE TABLE court_maps (
  place      TEXT PRIMARY KEY,
  venue      TEXT NOT NULL,
  address    TEXT NOT NULL,
  layout     TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 以前的图 (Ke Li 2026-11-15, 防止误操作): each plan a save or 删除 replaces is kept here for 30
-- days, the newest 10 per venue, so it can be brought back. updated_* say who made that plan and
-- when; replaced_at is when it stopped being the venue's plan.
CREATE TABLE court_map_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  place       TEXT NOT NULL,
  layout      TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  replaced_at TEXT NOT NULL
);
CREATE INDEX court_map_history_place ON court_map_history (place, id);
