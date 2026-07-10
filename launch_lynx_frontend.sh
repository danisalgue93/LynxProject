#!/usr/bin/env bash
set -euo pipefail

# ── Portable script root (works when called from anywhere) ────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# ── Load NVM if available ───────────────────────────────────────────────────────
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

# ── Set required environment defaults ───────────────────────────────────────────
export VITE_API_URL="${VITE_API_URL:-http://localhost:4000}"
export VITE_PROGRAM_ID="${VITE_PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"
export VITE_SOLANA_NETWORK="${VITE_SOLANA_NETWORK:-devnet}"
export NODE_ENV="${NODE_ENV:-development}"

# ── Ensure we're in the frontend directory ──────────────────────────────────────
cd "$FRONTEND_DIR" || { echo "Error: frontend directory not found at $FRONTEND_DIR"; exit 1; }

# ── Ensure node_modules are installed ───────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install || { echo "Error: npm install failed"; exit 1; }
fi

echo "Starting frontend dev server (VITE_API_URL=$VITE_API_URL, NETWORK=$VITE_SOLANA_NETWORK)..."
exec npm run dev
