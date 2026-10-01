-- Optional event title, e.g. "HappyTuesday 比赛", shown above the date.
ALTER TABLE events ADD COLUMN title TEXT NOT NULL DEFAULT '';
