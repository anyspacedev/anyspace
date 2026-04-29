# Teamship backend — plan

## Context

The Tauri desktop app (`src-tauri/`, `src/`) currently has zero backend. Every
external feature is BYO API key — the user pastes a Groq/OpenAI key into
Settings and the desktop app calls those vendors directly. There is no
`teamship.app` server beyond a placeholder `updates.teamship.app` URL in
`src-tauri/tauri.conf.json:30` that the auto-updater points at.

The Astro marketing landing (`landing/`) already promises a Pro tier with
14-day trial, Stripe-style billing, and Pro-gated features (AI agents,
broadcast, dictation). That plus the `updates.teamship.app` referenced from
the binary means a backend has to exist before public download.

In parallel, `ast-test/` is a working sherpa-onnx int8 SenseVoice ASR
service (FastAPI on the same box, exposed via Tailscale Funnel at
`https://ovh-us-west.otter-lydian.ts.net:8443/`) which the user has
end-to-end tested from iOS.

This plan turns `ast-test/` into the seed of the production backend, in
phases. Phase 1 ships the skeleton + the cloud transcription endpoint with
**no auth** (per user direction); user accounts and gating come in phase 2.

## Decisions (locked)

- **Stack**: Python 3.11 + FastAPI + Uvicorn. Reuses the ASR demo as-is.
- **Hosting**: same OVH box as the demo (`ovh-us-west`, 4 vCPU / 8 GB RAM /
  ~5.5 GB free disk). Tailscale Funnel terminates TLS.
- **Database**: SQLite for now, migrate to Postgres before the user-login
  launch (phase 2). Schemas authored with SQLAlchemy + Alembic so the
  migration path is just a `DATABASE_URL` swap.
- **Auth in phase 1**: none. The transcription endpoint is open behind
  rate limits and a long-secret header. Real auth (logged-in tokens) waits
  for phase 2.

## Phased rollout

### Phase 1 — backend skeleton + cloud transcription (this plan)

**Endpoints live**:
- `GET  /healthz` — liveness; recognizer loaded?
- `POST /v1/audio/transcriptions` — OpenAI-shaped multipart, runs sherpa-onnx
  int8 SenseVoice. Same response shape as `ast-test/scripts/server.py`.
- `GET  /updates/{target}/{arch}/{current_version}` — Tauri update manifest.
  Returns 204 No Content for now (no published release). Locks the contract
  the desktop binary already expects.

**Endpoints stubbed (return 501 Not Implemented, contract locked)**:
- `POST /v1/auth/start`, `POST /v1/auth/callback`, `GET /v1/me`
- `GET  /v1/license`, `POST /v1/license/refresh`
- `POST /v1/billing/checkout`, `POST /v1/billing/webhook`,
  `POST /v1/billing/portal`

These exist so the desktop app can be wired against the URL shape now and
upgraded in place when phase 2 fills them in.

**Operational**:
- systemd unit (`deploy/teamship-backend.service`) with
  `Restart=on-failure`, `MemoryMax=5G`.
- Tailscale Funnel at `https://api.<tailnet>.ts.net` (separate hostname or
  port from the ast-test demo so we can run them side by side during
  cutover).
- structured logs (structlog → JSON in prod, console in dev).
- nightly `pg_dump`/`sqlite3 .backup` cron writing to `/var/backups/teamship/`.
- ufw rule for the listen port (only needed if we drop Funnel later).

**Phase 1 explicitly does NOT do**:
- Users, sessions, OAuth, magic links, JWT
- Stripe checkout, webhooks, subscription state, trial logic
- Email
- Real Tauri update file hosting (just the manifest endpoint)
- Cloud AI chat endpoint
- Usage metering
- Multi-tenancy

### Phase 2 — user login system

- Pick the auth approach (Clerk vs Supabase vs build) — open question.
- Issue a long-lived refresh token + short-lived access JWT.
- Desktop app gains a Sign-in flow (deep-link OAuth or magic-link callback
  back to `tauri://localhost`).
- `/v1/audio/transcriptions` switches from "no auth" to "Bearer JWT
  required, free tier rate-limited, Pro unlimited".
- `/v1/me`, `/v1/license/refresh` go live.
- Fill in `users`, `sessions`, `oauth_identities` tables.

### Phase 3 — billing

- Stripe Checkout + Portal + webhooks.
- Subscriptions table; trial logic (14 days from first sign-in).
- Plan tiers from Stripe Products as source of truth; matches the landing.
- The transcription endpoint reads subscription state to apply Pro vs Free
  rate limits.

### Phase 4 — cloud AI chat, usage metering, Team plan, SSO

- `/v1/chat/completions` Pro endpoint that fronts a hosted LLM (cost-gated).
- `usage_events` table fed by all paid endpoints; per-user quotas.
- Team accounts (`organizations`, `org_members`).
- Google / GitHub / Okta SSO for Team tier.
- Real Tauri update artifact hosting (signed updates from GitHub Releases).

## Repository layout (phase 1)

```
backend/
├── PLAN.md                    # this file
├── README.md                  # dev + deploy instructions
├── pyproject.toml             # uv-managed
├── .python-version            # 3.11
├── .gitignore                 # data/, .venv/, *.db
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/              # one initial migration: api_keys placeholder
├── app/
│   ├── __init__.py
│   ├── main.py                # FastAPI factory + lifespan
│   ├── settings.py            # pydantic-settings, .env-driven
│   ├── db.py                  # SQLAlchemy engine + session
│   ├── deps.py                # FastAPI dependencies (db session, ratelimit)
│   ├── logging.py             # structlog config
│   ├── routers/
│   │   ├── health.py
│   │   ├── transcribe.py      # ports ast-test/scripts/server.py
│   │   ├── account.py         # 501 stubs for /v1/me, /v1/auth/*, /v1/license
│   │   ├── billing.py         # 501 stubs for /v1/billing/*
│   │   └── updates.py         # /updates/{target}/{arch}/{ver}
│   ├── services/
│   │   ├── asr.py             # singleton sherpa-onnx recognizer (lifespan)
│   │   ├── audio.py           # ffmpeg decode (lifted from server.py)
│   │   └── ratelimit.py       # IP token bucket; SlowAPI-backed
│   └── models/
│       ├── __init__.py
│       └── api_keys.py        # phase 1 schema placeholder; not enforced yet
├── tests/
│   ├── conftest.py            # FastAPI TestClient with lifespan
│   ├── test_health.py
│   ├── test_transcribe.py     # uses ast-test/audio/en.wav
│   ├── test_updates.py
│   └── test_stubs.py          # asserts stub endpoints return 501
└── deploy/
    ├── teamship-backend.service
    ├── Caddyfile              # optional; we'll likely use Tailscale Funnel
    └── deploy.sh              # rsync code, run alembic, restart unit
```

## Code reuse from `ast-test/`

The phase-1 transcription endpoint is a near-direct port of
`ast-test/scripts/server.py`. Specifically:

- `build_recognizer()` → `app/services/asr.py:get_recognizer()` (called
  once during FastAPI lifespan startup; the recognizer instance is held on
  `app.state.recognizer`).
- `decode_to_wav_pcm()` → `app/services/audio.py:decode_to_pcm()`
  (unchanged ffmpeg subprocess).
- `_patch_onnxruntime_symlink()` → `app/main.py` startup hook (same
  self-healing symlink helper, runs before `import sherpa_onnx`).
- `LANG_MAP` → `app/services/asr.py` constant.
- `index.html` from `ast-test/scripts/static/` is **not** ported. The demo
  page stays in `ast-test/`. The marketing landing is the public face of
  the product.

The `ast-test/` folder remains as the standalone benchmark + the demo we
showed the user. No code is deleted from it.

## Schema (phase 1)

Even though phase 1 has no user accounts, we land the migrations skeleton
so phase 2 is just adding tables.

`alembic/versions/001_init.py`:

```python
op.create_table(
    "api_keys",                                 # phase-2 placeholder
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("hash", sa.String(128), nullable=False, unique=True),
    sa.Column("label", sa.String(120), nullable=True),
    sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    sa.Column("revoked_at", sa.DateTime, nullable=True),
)
op.create_table(
    "audit_log",                                # tracks every transcription
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    sa.Column("ip", sa.String(64), nullable=False),
    sa.Column("path", sa.String(120), nullable=False),
    sa.Column("audio_sec", sa.Float, nullable=True),
    sa.Column("infer_sec", sa.Float, nullable=True),
    sa.Column("status", sa.Integer, nullable=False),
    sa.Column("user_id", sa.Integer, nullable=True),  # nullable until phase 2
)
```

`audit_log` is the bridge: phase 1 fills `ip` only; phase 2 starts filling
`user_id`. The transcription endpoint writes one row per request.

## API contract — phase 1

### `POST /v1/audio/transcriptions`

```http
Content-Type: multipart/form-data

file: <audio file, any format ffmpeg can decode>
language: en | zh | ja | ko | yue | auto   (optional, default auto)
model: <ignored, accepted for OpenAI parity>
response_format: json                       (only json supported)
```

Response 200:
```json
{
  "text": "...",
  "audio_sec": 12.3,
  "decode_sec": 0.04,
  "infer_sec": 0.41,
  "rtf": 0.0333,
  "lang_hint": "en"
}
```

Response 429 when rate-limited:
```json
{"detail": "rate limited", "retry_after_sec": 30}
```

### Rate limit (phase 1, no auth)

- Per source IP: 60 req/min, 600 req/hour, 30 min/day cumulative audio time.
- Per request: max 600s of audio, max 25 MB body.
- Implemented in `app/services/ratelimit.py` via in-memory token buckets
  keyed by IP. (Move to Redis in phase 3 when we're multi-process.)

The Tailscale Funnel + Caddy preserves the real client IP via
`X-Forwarded-For`; the rate-limit middleware reads that header (with a
trust-proxy allowlist).

## Settings / env vars

```
# .env (phase 1)
DATABASE_URL=sqlite:///./data/teamship.db
MODEL_CACHE_DIR=./data/models
LOG_LEVEL=info
LISTEN_HOST=127.0.0.1
LISTEN_PORT=9100                 # demo runs on 9000; backend takes 9100
TRUSTED_PROXY_IPS=127.0.0.1
RATE_LIMIT_PER_IP_PER_MIN=60
MAX_AUDIO_SECONDS=600
MAX_BODY_BYTES=26214400          # 25 MB
```

`pydantic-settings` reads `.env` and merges with process env so the
`teamship-backend.service` unit's `Environment=` directives win.

## Deploy plan

1. Provision the box (already done — same as ast-test).
2. `git pull` on the box, then run `cd backend && uv sync`.
3. Apply migrations: `uv run alembic upgrade head`.
4. Drop `deploy/teamship-backend.service` into `/etc/systemd/system/` and
   `systemctl enable --now teamship-backend`.
5. Add Tailscale Funnel mapping:
   `sudo tailscale funnel --bg --https=443 --set-path=/api 9100`
   so `https://<tailnet>.ts.net/api/v1/audio/transcriptions` reaches the
   backend, while the existing 8443 mapping keeps the demo alive during
   cutover. (Or: use a different hostname via `tailscale serve` with a CNAME
   from `api.teamship.app` once the domain is wired.)
6. Smoke test:
   `curl -X POST https://<host>/api/v1/audio/transcriptions -F file=@a.wav`
7. Update the Tauri app's STT settings to add a "Teamship Cloud (beta)"
   preset pointing at the new URL. (Desktop change; out of scope for this
   plan but tracked.)

## Wiring the desktop app (phase 1)

`src/stores/sttStore.ts` already has a `presetId` discriminator with
`groq | openai | elevenlabs | custom`. Phase 1 adds a 5th preset:

```ts
"teamship-cloud-beta"   // hardcoded endpoint, no api key, marked Beta in UI
```

`src-tauri/src/stt/commands.rs:69` already constructs
`{endpoint}/audio/transcriptions` from the stored `endpoint`, so no Rust
change is required — just frontend default + a banner saying "Beta, no
auth, rate-limited per-IP". Phase 2 changes the auth header from "none" to
"Bearer <session-jwt>" via the same code path.

## Tests (phase 1 must-have)

- `test_health.py` — `/healthz` returns 200 with `recognizer_ready: true`.
- `test_transcribe.py` — POST `audio/en.wav` → 200, `text` non-empty,
  `rtf < 1.0`. Marked `slow`; gated by env so CI without the model can skip.
- `test_updates.py` — `/updates/macos/aarch64/0.1.0` → 204.
- `test_stubs.py` — every stubbed endpoint returns 501 with a stable JSON
  shape so a desktop client written against it doesn't crash.
- `test_ratelimit.py` — fire 70 requests from the same client, expect 60
  successes and 10 429s with `retry_after_sec` set.

## Risks & mitigations

1. **Resource contention with `ast-test` demo**: the box is 4 vCPU / 8 GB.
   The demo holds ~810 MB RSS for sherpa-onnx; the backend will hold the
   same model — that's ~1.6 GB if both run. Plan: stop the ast-test demo
   before backend goes live, or share a single model server (next item).
2. **Two recognizer instances on one box**: cleanest fix once we cut over
   is to retire `ast-test/scripts/server.py` and run only the backend's
   transcription endpoint. Until then, both coexist on different ports.
3. **SQLite + uvicorn workers**: with `--workers > 1`, SQLite write
   contention shows up. Phase 1 runs **one** worker (CPU-bound on the ASR
   anyway). Concurrent transcription requests are serialized by
   sherpa-onnx's offline recognizer; that's acceptable at expected v1
   load. Promote to Postgres + multiple workers when traffic justifies it.
4. **Tailscale Funnel quotas**: a single tailnet has limited Funnel
   bandwidth. Fine for v1 demos and TestFlight-scale rollout; revisit
   before launch.
5. **Update manifest contract drift**: Tauri's expected JSON shape has
   evolved across versions. We pin to v2's `{ "version", "notes", "pub_date",
   "platforms": { "<target>-<arch>": { "url", "signature" } } }` and
   return 204 in phase 1 — Tauri treats 204 as "up to date".
6. **Migrations on SQLite**: Alembic on SQLite cannot do all DDL ops
   (e.g. drop column). Stick to add-only migrations until we move to
   Postgres. We'll never drop a shipped column on SQLite — we add a new
   one with a new name and stop reading the old.

## Open questions (defer to later phases, not blockers for phase 1)

- **Phase 2 auth provider**: Clerk vs Supabase Auth vs build it ourselves?
  Clerk has the strongest Google/GitHub/Okta story for Team-tier SSO; build
  is cheaper at v1 but expensive when SSO lands.
- **Domain**: when do we register `api.teamship.app` and point it at the
  Tailscale Funnel hostname (CNAME)?
- **Public IP / open ports**: do we keep Tailscale Funnel as the only
  ingress, or terminate TLS on the box with Caddy + Let's Encrypt? Funnel
  is simpler; Caddy gives us a normal domain.
- **Model serving**: stay with sherpa-onnx int8 forever? Phase 4 may want
  GPU + Whisper or Fun-ASR-MLT for accuracy.

## Verification checklist (phase 1 done means)

- [ ] `uv run pytest` passes locally.
- [ ] `systemctl status teamship-backend` is `active (running)` after deploy.
- [ ] `curl https://<host>/api/healthz` returns
      `{"ok": true, "recognizer_ready": true}`.
- [ ] `curl -X POST https://<host>/api/v1/audio/transcriptions
      -F file=@ast-test/audio/en.wav` returns the same JSON shape as the
      demo, with non-empty `text`.
- [ ] `curl https://<host>/api/updates/linux/x86_64/0.0.1` returns 204.
- [ ] All `/v1/auth/*`, `/v1/billing/*`, `/v1/me`, `/v1/license` return 501.
- [ ] Desktop app's "Teamship Cloud (beta)" STT preset transcribes a real
      browser recording end-to-end via Tailscale Funnel.
- [ ] `audit_log` table grew by N rows after N requests.
- [ ] Killing the uvicorn process and waiting 5s shows systemd restarted it.
