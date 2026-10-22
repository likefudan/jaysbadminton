-- The ReadBadmintonCalories Shortcut version a member last uploaded with (no version sent = 1), so the
-- event card can ask them to install a newer one. NULL until their first upload.
ALTER TABLE members ADD COLUMN calorie_shortcut_v INTEGER;
