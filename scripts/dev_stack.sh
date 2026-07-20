#!/usr/bin/env bash
set -euo pipefail

ROOT="/mnt/c/Users/danisalgue/Desktop/LynxProject"

export PROGRAM_ID="${PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:4000}"
# The frontend reads VITE_PROGRAM_ID (see lynxProgram.ts) and VITE_SOLANA_NETWORK
# (see useSolanaTransaction.ts). The old VITE_LYNX_PROGRAM_ID is kept only as a
# legacy alias; without VITE_PROGRAM_ID the on-chain features throw
# "VITE_PROGRAM_ID no está configurado", and without the devnet network they hit
# the wrong RPC.
export VITE_PROGRAM_ID="${VITE_PROGRAM_ID:-$PROGRAM_ID}"
export VITE_LYNX_PROGRAM_ID="${VITE_LYNX_PROGRAM_ID:-$PROGRAM_ID}"
export VITE_SOLANA_NETWORK="${VITE_SOLANA_NETWORK:-devnet}"
# Backend indexer/keeper RPC.
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"

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
