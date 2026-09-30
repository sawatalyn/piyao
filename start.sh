#!/usr/bin/env bash
# ============================================================================
#  Bianwang archive - one-click launcher FROM SOURCE (macOS / Linux / WSL).
#  Runs only what is still missing, then serves on a single port:
#    1. pnpm install                        (if node_modules is absent)
#    2. node server/scripts/reseed.js       (if server/data/posts.json is absent)
#    3. pnpm build                          (if web/dist/index.html is absent)
#    4. pnpm start                          (production: serves web/dist + API)
#  Usage:  ./start.sh      (chmod +x start.sh first if needed)
# ============================================================================
set -e
cd "$(dirname "$0")"

command -v pnpm >/dev/null 2>&1 || { echo "[X] pnpm not found. Install: npm install -g pnpm"; exit 1; }

if [ ! -d node_modules ]; then
  echo "[*] Installing dependencies... (.npmrc points at proxy http://127.0.0.1:7897 - edit if you have no proxy)"
  pnpm install
fi

if [ ! -f server/data/posts.json ]; then
  echo "[*] Writing first-run demo data..."
  node server/scripts/reseed.js
fi

if [ ! -f web/dist/index.html ]; then
  echo "[*] Building frontend into web/dist ..."
  pnpm build
fi

export BW_HOST="${BW_HOST:-127.0.0.1}"
export BW_PORT="${BW_PORT:-8787}"
export NODE_ENV="${NODE_ENV:-production}"

echo
echo "[*] Bianwang is running at http://${BW_HOST}:${BW_PORT}"
echo "    default login: admin / admin   (CHANGE THE PASSWORD AFTER FIRST LOGIN)"
echo "    press Ctrl+C to stop."
echo
pnpm start
