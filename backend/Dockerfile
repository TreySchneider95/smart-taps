FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    TAPS_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

# `docker compose exec backend taps ...` runs the management CLI
RUN printf '#!/bin/sh\nexec python -m taps "$@"\n' > /usr/local/bin/taps && chmod +x /usr/local/bin/taps docker-entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
