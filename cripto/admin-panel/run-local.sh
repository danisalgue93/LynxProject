#!/usr/bin/env bash
set -euo pipefail
source "$HOME/.nvm/nvm.sh"
cd /home/dani/lynx_project/admin-panel
chmod u+x node_modules/.bin/* 2>/dev/null || true
npm run build
npm run start
