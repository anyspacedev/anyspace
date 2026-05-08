#!/usr/bin/env bash
# Idempotent local-deploy script. Assumes the backend repo lives at
# /home/debian/app/backend on the target box. Run as the `debian` user.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/4] uv sync"
uv sync --no-dev

echo "[2/4] alembic upgrade head"
uv run alembic upgrade head

UNIT=/etc/systemd/system/anyspace-backend.service
if [[ ! -f "$UNIT" ]] || ! cmp -s deploy/anyspace-backend.service "$UNIT"; then
    echo "[3/4] installing systemd unit"
    sudo cp deploy/anyspace-backend.service "$UNIT"
    sudo systemctl daemon-reload
    sudo systemctl enable anyspace-backend
fi

echo "[4/4] systemctl restart"
sudo systemctl restart anyspace-backend

# Wait until /healthz reports recognizer_ready=true (model load can take ~1s).
echo -n "waiting for /healthz "
for _ in $(seq 1 30); do
    if curl -fs --max-time 2 "http://127.0.0.1:${LISTEN_PORT:-9100}/healthz" \
            | grep -q '"recognizer_ready":true'; then
        echo "ok"
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo
echo "FAIL: backend did not become ready in 30s. Recent logs:"
sudo journalctl -u anyspace-backend -n 30 --no-pager
exit 1
