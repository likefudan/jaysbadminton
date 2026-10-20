-- The language each Telegram chat reads the bot in (简体 / 繁體 / English), chosen in the bot by
-- sending 「语言」 and independent of the web pages. Keyed by chat, so the Owner's chat (in settings)
-- and organizers' and admins' (telegram_bindings) work alike. No row: 简体中文.
CREATE TABLE telegram_langs (
  chat_id TEXT NOT NULL PRIMARY KEY,
  lang    TEXT NOT NULL CHECK (lang IN ('zh-CN', 'zh-TW', 'en'))
);
