# AnySpace backend

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

## Run in Docker

The backend ships with a multi-stage `Dockerfile` and a `docker-compose.yml`
so the service can be started directly from its image. The compose stack
is single-replica; see "Parallel replicas" below before scaling out.

### Quick start

```bash
cd backend
docker compose build
docker compose up -d
docker compose logs -f api          # watch startup
curl http://127.0.0.1:9100/healthz  # {"ok":true,"recognizer_ready":true}
```

The sherpa-onnx int8 SenseVoice weights (~210 MB) are baked into the
image at build time, so cold start is offline-capable and finishes in
~5 s. On the first run against a fresh `anyspace-data` volume, Docker
copies the baked cache into the volume; subsequent boots read directly
from the volume. To use a different model, override `SHERPA_HF_REPO` /
`SHERPA_MODEL_FILE` / `SHERPA_TOKENS_FILE` — `app/services/asr.py` will
fall back to lazy `hf_hub_download` when the override isn't already
cached, which does need network on first run.

Smoke test once `/healthz` reports `recognizer_ready: true`:

```bash
curl -X POST http://127.0.0.1:9100/v1/audio/transcriptions \
     -F file=@../ast-test/audio/en.wav
```

### Configuration

Every setting is read from process env (pydantic-settings, see
`app/settings.py`). The compose file pre-sets the values that differ
between the systemd install and a containerized run; everything else
falls back to the in-code default. To override, either uncomment the
key under `services.api.environment:` in `docker-compose.yml` or pass
`-e KEY=VALUE` to `docker run`.

| Variable | Default (container) | Meaning |
| --- | --- | --- |
| **Network** | | |
| `LISTEN_HOST` | `0.0.0.0` | Bind address. **Must be `0.0.0.0` in the container** so the published port is reachable. The code default (`127.0.0.1`) is load-bearing for the systemd install — do not revert. |
| `LISTEN_PORT` | `9100` | Listen port. Change here and in `ports:` together. |
| `TRUSTED_PROXY_IPS` | `127.0.0.1,::1,100.64.0.0/10` | Comma-separated CIDRs whose `X-Forwarded-For` is trusted. |
| `CORS_ALLOW_ORIGINS` | `tauri://localhost,https://anyspace.dev,https://www.anyspace.dev` | Comma-separated allowed origins. |
| **Storage** | | |
| `DATABASE_URL` | `sqlite:///./data/anyspace.db` | SQLAlchemy URL. Resolves against the container's WORKDIR (`/app`) to `/app/data/anyspace.db`, which lives in the volume. |
| `MODEL_CACHE_DIR` | `/app/data/models` | HuggingFace cache dir for the sherpa weights. |
| **Logging** | | |
| `LOG_LEVEL` | `info` | uvicorn / structlog level. |
| `LOG_JSON` | `true` | Emit JSON log lines (set `false` for human-readable dev). |
| **Limits** | | |
| `RATE_LIMIT_PER_MIN` | `60` | Per-IP request budget. |
| `RATE_LIMIT_PER_HOUR` | `600` | Per-IP hourly cap. |
| `MAX_AUDIO_SECONDS` | `600` | Reject audio longer than this. |
| `MAX_BODY_BYTES` | `26214400` | 25 MB request body cap. |
| **Sherpa** | | |
| `SHERPA_HF_REPO` | `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` | HuggingFace repo for the model. |
| `SHERPA_MODEL_FILE` | `model.int8.onnx` | Model filename inside the repo. |
| `SHERPA_TOKENS_FILE` | `tokens.txt` | Tokens filename inside the repo. |
| `SHERPA_NUM_THREADS` | `4` | onnxruntime intra-op threads. Raise to use spare cores before adding replicas. |
| **Clerk auth** (all empty by default; webhooks return 503 until set) | | |
| `CLERK_PUBLISHABLE_KEY` | `""` | `pk_test_…` / `pk_live_…`. |
| `CLERK_SECRET_KEY` | `""` | `sk_…`. |
| `CLERK_FRONTEND_API` | `""` | e.g. `https://<slug>.clerk.accounts.dev`. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | `""` | Svix webhook secret. |
| `CLERK_JWT_LEEWAY_SEC` | `30` | Allowed clock skew for JWT validation. |
| **Stripe billing** (phase 3; `/v1/billing/*` return 503 until SECRET_KEY + PRICE_ID_MONTHLY set) | | |
| `STRIPE_SECRET_KEY` | `""` | `sk_test_…` / `sk_live_…`. |
| `STRIPE_WEBHOOK_SECRET` | `""` | `whsec_…`; powers `/v1/billing/webhook` (503 until set). |
| `STRIPE_PRICE_ID_MONTHLY` | `""` | `price_…` for the monthly "AnySpace Pro" price. |
| `STRIPE_PRICE_ID_ANNUAL` | `""` | Optional `price_…` for an annual price. |
| `STRIPE_CHECKOUT_SUCCESS_URL` | `https://anyspace.dev/billing/success` | Checkout redirect on success. |
| `STRIPE_CHECKOUT_CANCEL_URL` | `https://anyspace.dev/billing/cancel` | Checkout redirect on cancel. |
| `STRIPE_PORTAL_RETURN_URL` | `https://anyspace.dev/billing/portal-return` | Billing Portal return URL. |

#### Stripe dashboard setup (phase 3)

1. Create a Product **AnySpace Pro** with a monthly recurring Price (and
   optionally an annual Price); copy the `price_…` ids into the env vars above.
2. Enable the Customer Portal (allow cancel + update payment method).
3. Add a webhook endpoint → `https://api.anyspace.dev/v1/billing/webhook`,
   subscribed to `checkout.session.completed` and
   `customer.subscription.{created,updated,deleted}`; copy the `whsec_…` into
   `STRIPE_WEBHOOK_SECRET`.
4. The `anyspace.dev/billing/{success,cancel,portal-return}` pages live in the
   marketing-site project — the desktop app re-checks `/v1/license` on window
   focus rather than via a deep link, so they only need to tell the user to
   return to AnySpace.

For local testing: `stripe listen --forward-to localhost:9100/v1/billing/webhook`
and paste the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

### Volume

The named volume `anyspace-data` holds the SQLite DB and the model
cache, so restarts and image rebuilds preserve both.

```bash
docker volume inspect anyspace-data           # find the host path
docker run --rm -v anyspace-data:/data -v "$PWD":/backup busybox \
    tar czf /backup/anyspace-data.tgz -C /data .   # backup
```

Wiping the volume forces a fresh model download and resets the DB.

### Healthcheck and logs

```bash
docker compose ps
docker inspect --format '{{.State.Health.Status}}' anyspace-backend
docker compose logs -f api
```

### Parallel replicas

The compose file is intentionally single-replica. Three blockers must
land before `docker compose up --scale api=N` is safe:

- **sherpa-onnx is a CPU-bound singleton** held on `app.state.recognizer`
  (`app/main.py`). N replicas means N copies of the ~810 MB model in RAM;
  raising `SHERPA_NUM_THREADS` is more efficient than horizontal scale
  until cores saturate.
- **SQLite has one writer.** `audit_log` writes from concurrent replicas
  will lock-contend even with WAL. **Switch `DATABASE_URL` to Postgres
  before scaling out.**
- **The rate limiter is in-process** (token buckets in
  `app/services/ratelimit.py`); two replicas double the effective per-IP
  limit. **Move to Redis** before scaling out.

These match the phase-2/3 commitments in `PLAN.md`.

### Coexistence with the systemd install

The container and the systemd unit cannot run on the same host on `:9100`
at once. Stop one before starting the other:

```bash
sudo systemctl stop anyspace-backend && docker compose up -d
# or
docker compose down && sudo systemctl start anyspace-backend
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
sudo systemctl status anyspace-backend
journalctl -u anyspace-backend -f
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
"AnySpace Cloud (beta)" preset in `src/stores/sttStore.ts:47` whose
`endpoint` is `https://<host>/api` is the only desktop change needed for
phase 1. (No auth header yet; phase 2 adds Bearer.)

## What's NOT in phase 1

Email, real Tauri update file hosting, cloud AI chat endpoint, usage
metering, multi-tenancy. (User accounts + JWT landed in phase 2; Stripe
billing — `/v1/billing/*`, the `subscriptions` table, `/v1/license` — landed
in phase 3 but does not yet gate rate limits.) See `PLAN.md` for the
phase 2/3/4 roadmap.

## Operational notes

- One uvicorn worker. sherpa-onnx is CPU-bound; multiple workers don't
  help and SQLite contention shows up. Promote to N workers + Postgres in
  phase 2.
- `audit_log` grows; nothing prunes it yet. Add a cron in phase 2 if
  retention matters.
- Model cache: `data/models/`. Wipe it to force re-download.
- Rate limiter is in-memory — restarts wipe the buckets. That's intentional
  for phase 1; Redis-backed in phase 3.
