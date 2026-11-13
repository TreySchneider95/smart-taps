#!/usr/bin/env bash
# Optional: full-screen browser for the touch display. If you already have a kiosk
# set up the way you did for Workout Pal, just point it at http://localhost:8080/?kiosk=1
# (?kiosk=1 hides the mouse cursor). To use this script instead, add to ~/.config/labwc/autostart:
#   /home/<you>/smart-taps/deploy/kiosk.sh &
PORT="${APP_PORT:-8080}"
URL="http://localhost:${PORT}/?kiosk=1"
BROWSER="$(command -v chromium-browser || command -v chromium)"

# Docker starts the containers at boot; wait until the app answers.
until curl -sf -o /dev/null "http://localhost:${PORT}/api/health"; do sleep 2; done

while true; do
  "$BROWSER" \
    --kiosk --incognito --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --disable-features=Translate \
    --overscroll-history-navigation=0 --disable-pinch \
    --check-for-update-interval=31536000 --password-store=basic \
    "$URL"
  sleep 2
done
