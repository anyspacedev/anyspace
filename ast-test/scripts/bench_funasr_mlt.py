"""Benchmark Fun-ASR-MLT-Nano-2512 (PyTorch, CPU) on en/zh/ja/ko 60s clips.

This is the largest of the three candidates (~3 GB, 800 M params).

Special handling: the FunASRNano model class is NOT in the pypi `funasr`
package — it's only registered when funasr loads `model.py` from the
Fun-ASR repo via `trust_remote_code=True` + `remote_code=<path>`.
`model.py` itself imports sibling files (ctc.py, tools/utils.py), so we
have to vendor the whole repo rather than a single file. The script
shallow-clones it into `vendor/Fun-ASR/` on first run.
"""

from __future__ import annotations

import os
import resource
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor" / "Fun-ASR"
sys.path.insert(0, str(ROOT / "scripts"))


def ensure_vendor_repo() -> Path:
    """Shallow-clone FunAudioLLM/Fun-ASR if missing; return the model.py path."""
    model_py = VENDOR / "model.py"
    if model_py.exists():
        return model_py
    VENDOR.parent.mkdir(parents=True, exist_ok=True)
    print(f"[setup] cloning FunAudioLLM/Fun-ASR into {VENDOR} ...", flush=True)
    subprocess.check_call([
        "git", "clone", "--depth", "1",
        "https://github.com/FunAudioLLM/Fun-ASR.git",
        str(VENDOR),
    ])
    return model_py
from _bench import (  # noqa: E402
    audio_duration, audio_paths, dump_result,
    require_disk, time_phase,
)

MODEL_ID = "FunAudioLLM/Fun-ASR-MLT-Nano-2512"
MODEL_LABEL = "fun-asr-mlt-nano-2512"
MODEL_BYTES = 3_300 * 1024 * 1024  # ~3.3 GB

# Fun-ASR's `generate(language=...)` accepts language *names*, not ISO codes.
LANG_NAME = {
    "en": "English",
    "zh": "中文",
    "ja": "日本語",
    "ko": "한국어",
}


def main() -> int:
    cache_root = Path(os.environ.get("HF_HOME", str(ROOT / "models" / "hf")))
    require_disk(cache_root, MODEL_BYTES)

    model_py = ensure_vendor_repo()
    sys.path.insert(0, str(VENDOR))  # so `from ctc import CTC` resolves

    from funasr import AutoModel

    paths = audio_paths()

    with time_phase("load") as t_load:
        model = AutoModel(
            model=MODEL_ID,
            trust_remote_code=True,
            remote_code=str(model_py),
            device="cpu",
            hub="hf",
            disable_update=True,
            cache_dir=str(cache_root),
        )
    load_sec = t_load["elapsed"]

    # warm-up
    print("[warmup] running once on en.wav ...", flush=True)
    model.generate(input=[str(paths["en"])], language="English", itn=True)

    for lang, path in paths.items():
        audio_sec = audio_duration(path)
        with time_phase(f"infer:{lang}") as t_inf:
            res = model.generate(
                input=[str(path)],
                language=LANG_NAME[lang],
                itn=True,
            )
        infer_sec = t_inf["elapsed"]
        text = res[0]["text"]
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
