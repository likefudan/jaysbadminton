-- 头像 (Ke Li 2026-11-10): a member's own photo, else their Google profile picture, else none.
-- google_picture: the picture from the member's last Google sign-in (members.google_sub's account).
-- avatar: NULL = use the Google picture, 'none' = they chose no avatar, else the id of their photo
-- in member_avatars (a new random id on every upload, so the image URL can be cached forever).
ALTER TABLE members ADD COLUMN google_picture TEXT;
ALTER TABLE members ADD COLUMN avatar TEXT;

CREATE TABLE member_avatars (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members (id),
  image      BLOB NOT NULL,   -- JPEG, cropped square and shrunk on the phone first
  created_at TEXT NOT NULL
);
CREATE INDEX member_avatars_member ON member_avatars (member_id);

-- Members already signed in with Google keep the picture from their newest session.
UPDATE members SET google_picture = (
  SELECT s.picture FROM member_sessions s
  WHERE s.google_sub = members.google_sub AND s.picture IS NOT NULL
  ORDER BY s.expires_at DESC LIMIT 1
) WHERE google_sub IS NOT NULL AND deleted_at IS NULL;
