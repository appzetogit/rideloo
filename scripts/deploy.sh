#!/usr/bin/env sh
# Run ON THE SERVER, as the site user, from anywhere:
#   sh /home/rideloo/htdocs/rideloo.com/scripts/deploy.sh
#
# Env overrides:
#   APP_DIR   repo checkout            (default /home/rideloo/htdocs/rideloo.com)
#   WEB_ROOT  where nginx serves the built frontend from (default $APP_DIR/frontend-dist)
#   INDEXES=1 also run Backend/scripts/ensureIndexes.js (needed after schema index changes)
set -eu

APP_DIR="${APP_DIR:-/home/rideloo/htdocs/rideloo.com}"
WEB_ROOT="${WEB_ROOT:-$APP_DIR/frontend-dist}"

cd "$APP_DIR"
git pull --ff-only

echo "== backend =="
cd Backend
[ -f .env ] || { echo "Backend/.env is missing - create it from .env.example first" >&2; exit 1; }
npm install --omit=dev
[ "${INDEXES:-0}" = "1" ] && node scripts/ensureIndexes.js

if pm2 describe zicab-api-5000 >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "== frontend =="
cd ../frontend
[ -f .env.production ] || { echo "frontend/.env.production is missing - VITE_* values are compiled in at build time" >&2; exit 1; }
npm install
npm run build
mkdir -p "$WEB_ROOT"
rsync -a --delete dist/ "$WEB_ROOT"/

echo "== check =="
sleep 3
curl -fsS http://127.0.0.1:5000/health && echo
pm2 status
