# syntax=docker/dockerfile:1.7

# ---------- Builder: resolve deps with uv, materialize a self-contained venv ----------
FROM python:3.11-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev --no-install-project

# Pre-apply the libonnxruntime.so symlink that sherpa_onnx dlopens at import.
# Mirrors _patch_onnxruntime_symlink() in app/services/asr.py so the runtime
# venv stays root-owned/read-only.
RUN /app/.venv/bin/python - <<'PY'
import sysconfig
from pathlib import Path

site = Path(sysconfig.get_paths()["purelib"])
libs = site / "sherpa_onnx.libs"
target = libs / "libonnxruntime.so"
if target.exists():
    raise SystemExit(0)
capi = site / "onnxruntime" / "capi"
versioned = next(
    (p for p in capi.glob("libonnxruntime.so*")
     if p.name != "libonnxruntime_providers_shared.so"),
    None,
)
if versioned is None:
    raise SystemExit("onnxruntime shared library not found in builder venv")
libs.mkdir(exist_ok=True)
target.symlink_to(versioned)
PY


# ---------- Runtime: ffmpeg + baked venv, non-root, tini PID 1 ----------
FROM python:3.11-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH \
    HF_HOME=/app/data/hf-home

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ffmpeg libgomp1 ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --create-home --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown app:app /app/data

USER app

EXPOSE 9100

HEALTHCHECK --interval=15s --timeout=3s --start-period=120s --retries=4 \
    CMD python -c "import urllib.request,sys,json; \
r=json.load(urllib.request.urlopen('http://127.0.0.1:9100/healthz',timeout=2)); \
sys.exit(0 if r.get('recognizer_ready') else 1)"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["python", "-m", "app.main"]
