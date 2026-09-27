#!/usr/bin/env bash
# End-to-end API check: boots the server on a throwaway database seeded with
# the demo catalogue, runs the whole platform through its paces, tears down.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${TEST_PORT:-4631}"
TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export DATA_DIR="$TMP" PORT NODE_ENV=test
unset SMTP_HOST ANTHROPIC_API_KEY
node server/db/seed.js > /dev/null
node server/index.js > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/api/health" > /dev/null && break
  sleep 0.25
done
if ! curl -sf "http://localhost:$PORT/api/health" > /dev/null; then
  echo "server never came up:"; cat "$TMP/server.log"; exit 1
fi

BASE="http://localhost:$PORT" node test/e2e.mjs || { echo; echo "── server log ──"; grep -iE "error|warn" "$TMP/server.log" | tail -20; exit 1; }
