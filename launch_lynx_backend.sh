#!/usr/bin/env bash
set -euo pipefail

# ── Portable script root (works when called from anywhere) ────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

# ── Load NVM if available ───────────────────────────────────────────────────────
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

# ── Set required environment defaults ───────────────────────────────────────────
export PROGRAM_ID="${PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"
export NODE_ENV="${NODE_ENV:-development}"

# ── Ensure we're in the backend directory ───────────────────────────────────────
cd "$BACKEND_DIR" || { echo "Error: backend directory not found at $BACKEND_DIR"; exit 1; }

# ── Ensure node_modules are installed ───────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install || { echo "Error: npm install failed"; exit 1; }
fi

# ── Generate Prisma client if not present ───────────────────────────────────────
if [ ! -d "node_modules/.prisma/client" ]; then
  echo "Generating Prisma client..."
  npm run prisma:generate || { echo "Error: prisma generate failed"; exit 1; }
fi

echo "Starting backend server (NODE_ENV=$NODE_ENV, PROGRAM_ID=$PROGRAM_ID)..."
exec npm run dev
