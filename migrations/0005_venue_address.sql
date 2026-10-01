-- 地点 becomes 场馆 (venue name, still in events.location) + 地址 (street address).
-- Each venue remembers its address so picking a recent venue fills both.
ALTER TABLE events ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN address TEXT NOT NULL DEFAULT '';
