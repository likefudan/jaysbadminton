-- 个人信息: a contact email the member can set themselves (the Google account's email is shown
-- when this is empty), and a note only the admin sees, to tell people apart.
ALTER TABLE members ADD COLUMN email TEXT;
ALTER TABLE members ADD COLUMN admin_note TEXT;
