#!/usr/bin/env bash
set -euo pipefail

export PROGRAM_ID="${PROGRAM_ID:-CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu}"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

cd /mnt/c/Users/danisalgue/Desktop/LynxProject/backend
exec > /tmp/lynx-backend.log 2>&1
exec npm run dev
