"""Benchmark SenseVoiceSmall (PyTorch, CPU) on en/zh/ja/ko 60s clips."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _bench import (  # noqa: E402
    audio_duration, audio_paths, dump_result,
    require_disk, time_phase,
)

MODEL_ID = "iic/SenseVoiceSmall"
MODEL_LABEL = "sensevoice-small"
MODEL_BYTES = 470 * 1024 * 1024  # ~470 MB on disk


def main() -> int:
    cache_root = Path(os.environ.get("MODELSCOPE_CACHE", str(ROOT / "models" / "ms")))
    require_disk(cache_root, MODEL_BYTES)

    from funasr import AutoModel
    from funasr.utils.postprocess_utils import rich_transcription_postprocess

    paths = audio_paths()

    with time_phase("load") as t_load:
        model = AutoModel(
            model=MODEL_ID,
            trust_remote_code=False,
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30000},
            device="cpu",
            disable_update=True,
            cache_dir=str(cache_root),
        )
    load_sec = t_load["elapsed"]

    # warm-up: discard timing on the first English clip so JIT / kernels are hot.
    print("[warmup] running once on en.wav ...", flush=True)
    model.generate(input=str(paths["en"]), language="en",
                   use_itn=True, batch_size_s=60)

    for lang, path in paths.items():
        audio_sec = audio_duration(path)
        with time_phase(f"infer:{lang}") as t_inf:
            res = model.generate(
                input=str(path),
                language=lang,
                use_itn=True,
                batch_size_s=60,
            )
        infer_sec = t_inf["elapsed"]
        text = rich_transcription_postprocess(res[0]["text"])
        dump_result({
            "model": MODEL_LABEL,
            "lang": lang,
            "audio_sec": round(audio_sec, 3),
            "load_sec": round(load_sec, 3),
            "infer_sec": round(infer_sec, 3),
            "rtf": round(infer_sec / audio_sec, 4),
            "peak_rss_mb": round(__import__("resource").getrusage(
                __import__("resource").RUSAGE_SELF).ru_maxrss / 1024),
            "text": text,
        })
    return 0


if __name__ == "__main__":
    sys.exit(main())
