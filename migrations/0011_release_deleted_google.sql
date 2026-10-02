-- Deleted members used to keep their Google account, which blocked that person from applying
-- again. Their history stays; only the account binding is released (the email is kept on record).
UPDATE members SET google_sub = NULL WHERE deleted_at IS NOT NULL AND google_sub IS NOT NULL;
