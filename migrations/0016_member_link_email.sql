-- 找回我的专属链接: when the link was last re-sent by email, so one address gets at most one
-- recovery email an hour.
ALTER TABLE members ADD COLUMN link_resent_at TEXT;
