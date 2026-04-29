# Teamship backend

Phase 1: skeleton + cloud transcription. Plan: `PLAN.md`.

## What's implemented

- `GET  /healthz` — liveness; reports `recognizer_ready`.
- `POST /v1/audio/transcriptions` — OpenAI-shaped Whisper endpoint, runs
  sherpa-onnx int8 SenseVoice on CPU. No auth in phase 1; protected by
  per-IP token-bucket rate limit + max audio length + max body size.
- `GET  /updates/{target}/{arch}/{current_version}` — Tauri update
  manifest. Returns 204 (up-to-date) until phase 4 wires release metadata.
- Stubs returning **501 Not Implemented** for `/v1/auth/*`, `/v1/me`,
  `/v1/license`, `/v1/license/refresh`, `/v1/billing/*`. The contract is
  locked so the desktop app can be wired now.

## Dev

```bash
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m app.main
# in another shell:
curl http://127.0.0.1:9100/healthz
```

Tests:

```bash
uv run pytest                       # fast tests only
uv run pytest -m slow               # also hits the real sherpa-onnx model
```

## Layout

```
app/
├── main.py             # FastAPI factory + lifespan (loads recognizer once)
├── settings.py         # pydantic-settings env config
├── db.py               # SQLAlchemy engine + session, SQLite WAL pragma
├── deps.py             # FastAPI deps (client_ip with X-Forwarded-For trust)
├── logging.py          # structlog
├── routers/            # health, transcribe, updates, account stubs, billing stubs
├── services/           # asr (sherpa-onnx singleton), audio (ffmpeg decode), ratelimit
└── models/             # SQLAlchemy: api_keys (phase 2), audit_log (active)
alembic/versions/       # 0001_init: api_keys + audit_log tables
tests/                  # pytest; recognizer is stubbed except in slow tests
deploy/                 # systemd unit + deploy.sh
data/                   # gitignored: SQLite db + downloaded model weights
```

## Deploy (this box)

The `deploy/deploy.sh` script is idempotent — it `uv sync`s, applies
migrations, installs/refreshes the systemd unit, and waits for `/healthz`
to report ready. Run from the backend dir on the target box:

```bash
./deploy/deploy.sh
sudo systemctl status teamship-backend
journalctl -u teamship-backend -f
```

The backend listens on `127.0.0.1:9100`. To expose it over HTTPS, add a
Tailscale Funnel mapping:

```bash
sudo tailscale funnel --bg --https=8443 9100   # if 8443 is free
# OR (if 8443 holds the ast-test demo): retire the demo first, then map 443
sudo tailscale funnel --bg --https=443 9100
```

The ast-test demo (`../ast-test/scripts/server.py`) listens on `:9000` and
its Funnel mapping is on `:8443`. Phase-1 backend can run alongside it on
different ports until cutover, then we retire the demo to free RAM.

## How the desktop app talks to this

`src-tauri/src/stt/commands.rs:69` already builds
`{endpoint}/audio/transcriptions` and posts multipart. So adding a
"Teamship Cloud (beta)" preset in `src/stores/sttStore.ts:47` whose
`endpoint` is `https://<host>/api` is the only desktop change needed for
phase 1. (No auth header yet; phase 2 adds Bearer.)

## What's NOT in phase 1

User accounts, sessions, OAuth, JWT, Stripe, email, real Tauri update
file hosting, cloud AI chat endpoint, usage metering, multi-tenancy.
See `PLAN.md` for the phase 2/3/4 roadmap.

## Operational notes

- One uvicorn worker. sherpa-onnx is CPU-bound; multiple workers don't
  help and SQLite contention shows up. Promote to N workers + Postgres in
  phase 2.
- `audit_log` grows; nothing prunes it yet. Add a cron in phase 2 if
  retention matters.
- Model cache: `data/models/`. Wipe it to force re-download.
- Rate limiter is in-memory — restarts wipe the buckets. That's intentional
  for phase 1; Redis-backed in phase 3.
