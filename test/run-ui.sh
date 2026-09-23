#!/usr/bin/env bash
# Browser walk-through of the full hiring flow. Needs playwright + chromium:
#   npm i -D playwright && npx playwright install chromium
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${UI_TEST_PORT:-4411}"
TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export DATA_DIR="$TMP"
export PORT
node server/db/seed.js -- --demo > /dev/null   # the suites need the sample roles as fixtures
node server/index.js > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/api/health" > /dev/null && break
  sleep 0.25
done

BASE="http://localhost:$PORT" node test/ui.mjs
