-- 拍照登记用量 (Ke Li, 2026-11-03): one row per call to an AI model, with the tokens Azure says it
-- used, so the admin event page can show how many photos were read, the tokens and an estimated
-- price. Kept for good (queue_photos goes after 7 days). Failed calls count too: they cost tokens.
-- request groups the calls of one photo (the pick, then the fallback when the pick failed).
-- event_id is NULL for uses that aren't about an event (the release notice's 发版说明).
CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request       TEXT NOT NULL,
  use           TEXT NOT NULL,                     -- 'photo' | 'notes'
  event_id      INTEGER REFERENCES events (id),
  model         TEXT NOT NULL,                     -- the Azure deployment called
  effort        TEXT NOT NULL,
  fallback      INTEGER NOT NULL DEFAULT 0,        -- 1: the pick failed and this was the fallback
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,        -- thinking included
  ok            INTEGER NOT NULL,                  -- 1: an answer came back and was read
  created_at    TEXT NOT NULL
);
CREATE INDEX ai_usage_event ON ai_usage (event_id) WHERE event_id IS NOT NULL;
