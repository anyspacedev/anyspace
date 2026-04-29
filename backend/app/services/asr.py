"""Sherpa-onnx int8 SenseVoice recognizer, loaded once per process.

The pypi sherpa-onnx wheel does not bundle libonnxruntime.so; it dlopens an
unversioned `libonnxruntime.so` from RPATH. The onnxruntime pip package
ships only `libonnxruntime.so.X.Y.Z`. `_patch_onnxruntime_symlink()` below
creates the missing alias the first time we import the recognizer, so a
fresh `uv sync` works without manual steps. Lifted from
ast-test/scripts/bench_sherpa.py — single source of truth lives there.
"""

from __future__ import annotations

import sysconfig
from pathlib import Path

from huggingface_hub import hf_hub_download

from ..settings import get_settings


def _patch_onnxruntime_symlink() -> None:
    site = Path(sysconfig.get_paths()["purelib"])
    libs = site / "sherpa_onnx.libs"
    target = libs / "libonnxruntime.so"
    if target.exists():
        return
    capi = site / "onnxruntime" / "capi"
    versioned = next(
        (p for p in capi.glob("libonnxruntime.so*")
         if p.name != "libonnxruntime_providers_shared.so"),
        None,
    )
    if versioned is None:
        return
    libs.mkdir(exist_ok=True)
    target.symlink_to(versioned)


# IMPORTANT: must run before `import sherpa_onnx`.
_patch_onnxruntime_symlink()

import sherpa_onnx  # noqa: E402

LANG_MAP = {
    "": "auto", "auto": "auto",
    "en": "en", "english": "en",
    "zh": "zh", "chinese": "zh",
    "ja": "ja", "japanese": "ja",
    "ko": "ko", "korean": "ko",
    "yue": "yue", "cantonese": "yue",
}


def build_recognizer() -> sherpa_onnx.OfflineRecognizer:
    settings = get_settings()
    cache = settings.model_cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    model = hf_hub_download(
        repo_id=settings.sherpa_hf_repo,
        filename=settings.sherpa_model_file,
        cache_dir=str(cache),
    )
    tokens = hf_hub_download(
        repo_id=settings.sherpa_hf_repo,
        filename=settings.sherpa_tokens_file,
        cache_dir=str(cache),
    )
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model),
        tokens=str(tokens),
        num_threads=settings.sherpa_num_threads,
        use_itn=True,
        debug=False,
        language="auto",
    )


def transcribe_pcm(
    recognizer: sherpa_onnx.OfflineRecognizer,
    samples,
    sample_rate: int,
) -> str:
    """Single-shot decode of a 16 kHz mono float32 numpy array."""
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate=sample_rate, waveform=samples)
    recognizer.decode_stream(stream)
    return stream.result.text
