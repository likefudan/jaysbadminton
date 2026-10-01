-- 删除 a disabled member: their history stays, the link stops working, and they move to 已删除.
ALTER TABLE members ADD COLUMN deleted_at TEXT;
