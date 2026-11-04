-- 专属链接 go away for members who sign in with Google (Ke Li 2026-11-04): a member with a Google
-- account bound keeps no /m/ link, and the admin can neither see nor make one for them.
UPDATE members SET token_hash = NULL, token_enc = NULL WHERE google_sub IS NOT NULL;
