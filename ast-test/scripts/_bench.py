"""Shared timing / RSS / disk helpers for the bench_*.py scripts."""

from __future__ import annotations

import contextlib
import json
import resource
import shutil
import sys
import time
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
RESULTS_PATH = ROOT / "results" / "results.json"
AUDIO_DIR = ROOT / "audio"
LANGS = ("en", "zh", "ja", "ko")


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return rss / (1024 * 1024)
    return rss / 1024


@contextlib.contextmanager
def time_phase(label: str):
    print(f"[{label}] ...", flush=True)
    t0 = time.perf_counter()
    state = {"elapsed": 0.0}
    try:
        yield state
    finally:
        state["elapsed"] = time.perf_counter() - t0
        print(f"[{label}] {state['elapsed']:.3f}s   peak_rss={peak_rss_mb():.0f} MB",
              flush=True)


def audio_duration(path: Path) -> float:
    return float(sf.info(str(path)).duration)


def require_disk(path: Path, need_bytes: int) -> None:
    """Bail early if the cache mount can't fit `need_bytes` + 500 MB headroom."""
    path.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(path).free
    headroom = 500 * 1024 * 1024
    if free < need_bytes + headroom:
        free_gb = free / 1e9
        need_gb = (need_bytes + headroom) / 1e9
        sys.exit(
            f"ERROR: only {free_gb:.2f} GB free on {path}; need {need_gb:.2f} GB.\n"
            f"See ast-test/README.md §Phase 0 for cleanup or HF_HOME relocation."
        )


def dump_result(row: dict) -> None:
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    if RESULTS_PATH.exists():
        try:
            rows = json.loads(RESULTS_PATH.read_text())
            if not isinstance(rows, list):
                rows = []
        except json.JSONDecodeError:
            rows = []
    rows = [r for r in rows if not (
        r.get("model") == row["model"] and r.get("lang") == row["lang"]
    )]
    rows.append(row)
    RESULTS_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    print(f"  -> wrote {row['model']}/{row['lang']} to {RESULTS_PATH.name}",
          flush=True)


def audio_paths() -> dict[str, Path]:
    out = {}
    for lang in LANGS:
        p = AUDIO_DIR / f"{lang}.wav"
        if not p.exists():
            sys.exit(
                f"ERROR: missing {p}. Run scripts/fetch_audio.py first, "
                "or drop your own 16 kHz mono WAVs in audio/."
            )
        out[lang] = p
    return out
