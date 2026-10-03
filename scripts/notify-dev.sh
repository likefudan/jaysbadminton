#!/bin/sh
# Posts one plain-text message to the developers' Telegram group (not the Owner's site bot).
# Usage: scripts/notify-dev.sh "text"   — needs TELEGRAM_DEV_BOT_TOKEN and TELEGRAM_DEV_CHAT_ID.
# Never fails the job: without the secrets it skips, and a Telegram error is only a warning.
set -u
if [ -z "${TELEGRAM_DEV_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_DEV_CHAT_ID:-}" ]; then
  echo "Developer notices are off (TELEGRAM_DEV_BOT_TOKEN / TELEGRAM_DEV_CHAT_ID not set)."
  exit 0
fi
body=$(jq -n --arg chat "$TELEGRAM_DEV_CHAT_ID" --arg text "$1" \
  '{chat_id: $chat, text: $text, link_preview_options: {is_disabled: true}}')
if ! curl -sS --fail-with-body --max-time 15 -H "Content-Type: application/json" -d "$body" \
  "https://api.telegram.org/bot${TELEGRAM_DEV_BOT_TOKEN}/sendMessage" > /dev/null; then
  echo "::warning::Could not post to the developers' Telegram group"
fi
