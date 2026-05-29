#!/usr/bin/env bash
set -euo pipefail

ROOT="/mnt/c/Users/danisalgue/Desktop/LynxProject"

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
trap cleanup INT TERM EXIT

cd "$ROOT/backend"
npm run dev &

cd "$ROOT/frontend"
npm run dev &

echo "Lynx dev stack running:"
echo "- Frontend: http://localhost:3000"
echo "- Backend:  http://localhost:4000/api/health"
echo "Press Ctrl+C to stop."

wait
