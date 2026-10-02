-- A deleted member's name is freed for someone new: the old record keeps it with the member ID
-- appended (e.g. "Alice（M004）"), which is unique and shows everywhere the history does.
UPDATE members SET username = username || '（' || id || '）' WHERE deleted_at IS NOT NULL AND username NOT LIKE '%（' || id || '）';
