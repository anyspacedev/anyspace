"""Demo ASR server: sherpa-onnx int8 SenseVoice behind an OpenAI-shaped
`/audio/transcriptions` endpoint, plus a one-page browser recorder at `/`.

Usage:
    uv run python scripts/server.py            # binds 0.0.0.0:9000
    uv run python scripts/server.py --port 8000

Open http://<host>:<port>/ in a browser, hold Record, release to transcribe.
"""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
import time
import wave
from pathlib import Path

# sherpa-onnx pypi wheels need the libonnxruntime.so symlink — reuse the
# self-healing helper from bench_sherpa.py so a fresh checkout just works.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from bench_sherpa import _patch_onnxruntime_symlink  # noqa: E402

_patch_onnxruntime_symlink()

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from huggingface_hub import hf_hub_download

HF_REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
INDEX_HTML = ROOT / "scripts" / "static" / "index.html"

LANG_MAP = {
    "": "auto", "auto": "auto",
    "en": "en", "english": "en",
    "zh": "zh", "chinese": "zh",
    "ja": "ja", "japanese": "ja",
    "ko": "ko", "korean": "ko",
    "yue": "yue", "cantonese": "yue",
}


def build_recognizer() -> sherpa_onnx.OfflineRecognizer:
    cache = ROOT / "models" / "hf"
    model = hf_hub_download(repo_id=HF_REPO, filename="model.int8.onnx",
                            cache_dir=str(cache))
    tokens = hf_hub_download(repo_id=HF_REPO, filename="tokens.txt",
                             cache_dir=str(cache))
    print(f"[setup] loading sherpa-onnx int8 SenseVoice from {Path(model).name}")
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model),
        tokens=str(tokens),
        num_threads=4,
        use_itn=True,
        debug=False,
        language="auto",
    )


def decode_to_wav_pcm(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Use ffmpeg to convert any browser-emitted blob (webm/opus, ogg, mp4...)
    to 16 kHz mono float32 samples."""
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error",
         "-i", "pipe:0", "-ar", "16000", "-ac", "1",
         "-f", "wav", "pipe:1"],
        input=audio_bytes, capture_output=True,
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"ffmpeg decode failed: {proc.stderr.decode(errors='replace')[:500]}",
        )
    with wave.open(io.BytesIO(proc.stdout), "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sr


# ---- FastAPI app ----------------------------------------------------------

app = FastAPI(title="ast-test demo ASR")
recognizer: sherpa_onnx.OfflineRecognizer | None = None


@app.on_event("startup")
def _load_model() -> None:
    global recognizer
    recognizer = build_recognizer()
    print("[setup] recognizer ready")


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(INDEX_HTML.read_text())


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": recognizer is not None}


@app.post("/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    model: str | None = Form(default=None),
    response_format: str | None = Form(default="json"),
) -> JSONResponse:
    """OpenAI-compatible Whisper-style endpoint.
    Body is `multipart/form-data` with at least `file=<audio>`.
    """
    if recognizer is None:
        raise HTTPException(503, "recognizer not loaded yet")
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "empty file")

    t_decode = time.perf_counter()
    samples, sr = decode_to_wav_pcm(audio_bytes)
    decode_sec = time.perf_counter() - t_decode

    lang = LANG_MAP.get((language or "").lower(), "auto")
    t_inf = time.perf_counter()
    stream = recognizer.create_stream()
    # sherpa-onnx applies the language tag from the recognizer, not the
    # stream — the recognizer's `language` is "auto" which the model
    # autodetects from the audio. This matches what the bench script did.
    stream.accept_waveform(sample_rate=sr, waveform=samples)
    recognizer.decode_stream(stream)
    text = stream.result.text
    infer_sec = time.perf_counter() - t_inf

    audio_sec = len(samples) / sr
    return JSONResponse({
        "text": text,
        # Non-OpenAI extras for the demo page:
        "audio_sec": round(audio_sec, 3),
        "decode_sec": round(decode_sec, 3),
        "infer_sec": round(infer_sec, 3),
        "rtf": round(infer_sec / max(audio_sec, 1e-6), 4),
        "lang_hint": lang,
    })


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=9000)
    args = ap.parse_args()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
