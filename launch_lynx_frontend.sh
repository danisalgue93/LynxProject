#!/usr/bin/env bash
set -euo pipefail

export VITE_API_URL="${VITE_API_URL:-http://localhost:4000}"
export VITE_LYNX_PROGRAM_ID="${VITE_LYNX_PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

cd /mnt/c/Users/danisalgue/Desktop/LynxProject/frontend
exec > /tmp/lynx-frontend.log 2>&1
exec npm run dev
