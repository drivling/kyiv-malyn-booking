#!/usr/bin/env bash
set -euo pipefail

# TODO: замени на URL твоего backend/API.
VIBER_BACKEND_URL="https://kyiv-malyn-booking-production.up.railway.app"
VIBER_ADMIN_TOKEN="${VIBER_ADMIN_TOKEN:-admin-authenticated}"
VIBER_CHAT_ID="${VIBER_CHAT_ID:-1}"

if [[ "$VIBER_BACKEND_URL" == "https://твой-сайт-or-backend-url" ]]; then
  echo "Ошибка: укажи реальный VIBER_BACKEND_URL в viberparser/run_db_parser.sh"
  echo "Например: VIBER_BACKEND_URL=\"https://malin.kiev.ua\""
  exit 1
fi

cd "$(dirname "$0")/.."

# VIBER_UI_POLL_INTERVAL_SEC=3 \
VIBER_BACKEND_URL="$VIBER_BACKEND_URL" \
VIBER_ADMIN_TOKEN="$VIBER_ADMIN_TOKEN" \
python3 viberparser/parser.py --send --chat-id "$VIBER_CHAT_ID"
