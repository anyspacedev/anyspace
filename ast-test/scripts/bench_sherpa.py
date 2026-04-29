"""Benchmark sherpa-onnx int8 SenseVoice on en/zh/ja/ko 60s clips.

Uses the official quantized archive published by k2-fsa:
    csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
"""

from __future__ import annotations

import os
import resource
import sys
from pathlib import Path


def _patch_onnxruntime_symlink() -> None:
    """sherpa-onnx pypi wheels look for `libonnxruntime.so` (unversioned) inside
    site-packages/sherpa_onnx.libs/, but the onnxruntime wheel ships
    `libonnxruntime.so.X.Y.Z`. Create the symlink the first time we run.
    """
    import sysconfig
    site = Path(sysconfig.get_paths()["purelib"])
    libs = site / "sherpa_onnx.libs"
    target = libs / "libonnxruntime.so"
    if target.exists():
        return
    capi = site / "onnxruntime" / "capi"
    versioned = next((p for p in capi.glob("libonnxruntime.so*")
                      if p.name != "libonnxruntime_providers_shared.so"), None)
    if versioned is None:
        return
    libs.mkdir(exist_ok=True)
    target.symlink_to(versioned)
    print(f"[setup] linked {target.name} -> {versioned.name}")


_patch_onnxruntime_symlink()

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _bench import (  # noqa: E402
    audio_duration, audio_paths, dump_result,
    require_disk, time_phase,
)

MODEL_LABEL = "sherpa-onnx-int8"
HF_REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
MODEL_FILES = ["model.int8.onnx", "tokens.txt"]
MODEL_BYTES = 250 * 1024 * 1024  # int8 model + tokens, ~230 MB


def fetch_model(cache_root: Path) -> tuple[Path, Path]:
    from huggingface_hub import hf_hub_download
    paths = []
    for fn in MODEL_FILES:
        p = hf_hub_download(repo_id=HF_REPO, filename=fn,
                            cache_dir=str(cache_root))
        paths.append(Path(p))
    return paths[0], paths[1]


def main() -> int:
    cache_root = Path(os.environ.get("HF_HOME", str(ROOT / "models" / "hf")))
    require_disk(cache_root, MODEL_BYTES)

    model_path, tokens_path = fetch_model(cache_root)

    import sherpa_onnx

    paths = audio_paths()

    with time_phase("load") as t_load:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            num_threads=4,
            use_itn=True,
            debug=False,
            language="auto",  # we override per-clip below via create_stream
        )
    load_sec = t_load["elapsed"]

    # warm-up
    samples, sr = sf.read(str(paths["en"]), dtype="float32")
    s = recognizer.create_stream()
    s.accept_waveform(sample_rate=sr, waveform=samples)
    recognizer.decode_stream(s)

    for lang, path in paths.items():
        audio_sec = audio_duration(path)
        samples, sr = sf.read(str(path), dtype="float32")
        if samples.ndim > 1:
            samples = samples.mean(axis=1).astype(np.float32)
        with time_phase(f"infer:{lang}") as t_inf:
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate=sr, waveform=samples)
            recognizer.decode_stream(stream)
        infer_sec = t_inf["elapsed"]
        text = stream.result.text
        dump_result({
            "model": MODEL_LABEL,
            "lang": lang,
            "audio_sec": round(audio_sec, 3),
            "load_sec": round(load_sec, 3),
            "infer_sec": round(infer_sec, 3),
            "rtf": round(infer_sec / audio_sec, 4),
            "peak_rss_mb": round(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
            "text": text,
        })
    return 0


if __name__ == "__main__":
    sys.exit(main())
