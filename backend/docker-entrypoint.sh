#!/bin/sh
set -e

# Create data/config.toml and the database on first run, then start the API.
python -m taps init
exec uvicorn taps.server:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
