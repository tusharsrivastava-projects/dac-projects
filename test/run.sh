#!/usr/bin/env bash
# End-to-end check: boots the server against a throwaway database, walks a
# candidate from registration to an accepted offer, then tears everything down.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${TEST_PORT:-4311}"
TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export DATA_DIR="$TMP"
export PORT
node server/db/seed.js > /dev/null
node server/index.js > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null; then break; fi
  sleep 0.25
done

if ! curl -sf "http://localhost:$PORT/api/health" > /dev/null; then
  echo "server never came up:"; cat "$TMP/server.log"; exit 1
fi

BASE="http://localhost:$PORT" node test/e2e.mjs
