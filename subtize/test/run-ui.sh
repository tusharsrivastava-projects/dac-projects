#!/usr/bin/env bash
# Browser walk-through. Needs Playwright + Chromium:
#   npm i -D playwright && npx playwright install chromium
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${UI_TEST_PORT:-4641}"
TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export DATA_DIR="$TMP" PORT NODE_ENV=test ADMIN_EMAIL=admin@subtize.ai ADMIN_PASSWORD=subtize-admin-2026
unset SMTP_HOST ANTHROPIC_API_KEY
node server/db/seed.js > /dev/null
node server/index.js > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/api/health" > /dev/null && break
  sleep 0.25
done

BASE="http://localhost:$PORT" node test/ui.mjs
