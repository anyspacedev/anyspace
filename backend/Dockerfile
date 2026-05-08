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

# Pre-download sherpa-onnx int8 SenseVoice weights into /app/baked-models so
# the runtime stage can ship them inside the image — no HuggingFace traffic
# on first boot. Repo/filenames mirror app/settings.py defaults; override at
# runtime by setting SHERPA_HF_REPO/MODEL_FILE/TOKENS_FILE (the lazy
# hf_hub_download path in app/services/asr.py still runs for overrides).
ARG SHERPA_HF_REPO=csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
ARG SHERPA_MODEL_FILE=model.int8.onnx
ARG SHERPA_TOKENS_FILE=tokens.txt
ENV SHERPA_HF_REPO=${SHERPA_HF_REPO} \
    SHERPA_MODEL_FILE=${SHERPA_MODEL_FILE} \
    SHERPA_TOKENS_FILE=${SHERPA_TOKENS_FILE}
RUN /app/.venv/bin/python - <<'PY'
import os
from huggingface_hub import hf_hub_download

repo = os.environ["SHERPA_HF_REPO"]
cache = "/app/baked-models"
for fname in (os.environ["SHERPA_MODEL_FILE"], os.environ["SHERPA_TOKENS_FILE"]):
    p = hf_hub_download(repo_id=repo, filename=fname, cache_dir=cache)
    print(f"baked {fname} -> {p}")
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

# Baked model cache. When MODEL_CACHE_DIR points at /app/data/models and a
# fresh named volume is mounted there, Docker copies these files into the
# empty volume — so first boot is offline-capable. Pre-existing volumes
# (e.g. an older deploy) keep their own cache, which is also fine.
COPY --from=builder /app/baked-models /app/data/models

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown -R app:app /app/data

USER app

EXPOSE 9100

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=4 \
    CMD python -c "import urllib.request,sys,json; \
r=json.load(urllib.request.urlopen('http://127.0.0.1:9100/healthz',timeout=2)); \
sys.exit(0 if r.get('recognizer_ready') else 1)"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["python", "-m", "app.main"]
