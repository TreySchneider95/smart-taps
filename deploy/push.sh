#!/usr/bin/env bash
# Copy this project from your Mac to the Pi and rebuild/restart the containers.
# The kiosk notices the restart and reloads itself. Your data/ and .env on the Pi are left alone.
#
#   ./deploy/push.sh pi@kegerator.local
#   (or set TAPS_HOST once:  export TAPS_HOST=pi@kegerator.local)
set -euo pipefail

HOST="${1:-${TAPS_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "usage: $0 user@pi-hostname.local" >&2
  exit 1
fi
SRC="$(cd "$(dirname "$0")/.." && pwd)/"

rsync -az --delete \
  --exclude data/ --exclude .env --exclude docker-compose.override.yml \
  --exclude .venv --exclude __pycache__ --exclude .git --exclude .DS_Store \
  "$SRC" "$HOST:smart-taps/"

ssh "$HOST" "cd smart-taps && docker compose up -d --build"
