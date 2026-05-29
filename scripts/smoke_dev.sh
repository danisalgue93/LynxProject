#!/usr/bin/env bash
set -euo pipefail

ROOT="/mnt/c/Users/danisalgue/Desktop/LynxProject"
BACKEND_LOG="/tmp/lynx-backend.log"
FRONTEND_LOG="/tmp/lynx-frontend.log"

export PROGRAM_ID="${PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:4000}"
export VITE_LYNX_PROGRAM_ID="${VITE_LYNX_PROGRAM_ID:-$PROGRAM_ID}"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

cleanup() {
  local children
  children="$(jobs -pr || true)"
  if [ -n "$children" ]; then
    kill $children 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT/backend"
npm run dev >"$BACKEND_LOG" 2>&1 &

cd "$ROOT/frontend"
npm run dev >"$FRONTEND_LOG" 2>&1 &

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/tmp/lynx-health.json 2>/dev/null &&
     curl -fsS --max-time 2 http://127.0.0.1:4000/api/markets >/tmp/lynx-markets.json 2>/dev/null &&
     curl -fsSI --max-time 2 http://127.0.0.1:3000/ >/tmp/lynx-frontend.headers 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "== sockets =="
ss -ltnp | grep -E ':(3000|4000)' || true

echo
echo "== backend health =="
cat /tmp/lynx-health.json

echo
echo "== markets =="
cat /tmp/lynx-markets.json

echo
echo "== frontend headers =="
head -20 /tmp/lynx-frontend.headers

echo
echo "== logs =="
tail -n 40 "$BACKEND_LOG" "$FRONTEND_LOG"
