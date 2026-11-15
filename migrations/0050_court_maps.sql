-- 球场图 (Ke Li 2026-11-15): each venue's floor plan, read from a photo of the plan posted at the
-- venue and checked by whoever took it. Keyed by the venue's name as events carry it (case aside),
-- so it stays when the venue drops off 最近的场馆. layout is JSON (src/shared/courtMap.ts);
-- updated_by is a member id, without a foreign key so 清空所有数据 and member removal never trip on it.
CREATE TABLE court_maps (
  venue      TEXT PRIMARY KEY COLLATE NOCASE,
  layout     TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
