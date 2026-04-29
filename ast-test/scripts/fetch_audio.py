"""Build audio/{en,zh,ja,ko}.wav — 60 s of 16 kHz mono each.

Strategy: pull the SenseVoice repo's bundled `example/{lang}.mp3` from
Hugging Face (public, ungated, ~hundreds of KB total), decode them, and
loop-concat each clip to ~60 s with short silence between repeats. That
keeps the benchmark deterministic and reproducible without dragging in
gated Common Voice splits.

If audio/{lang}.wav already exists it's left alone — drop your own
real-world clips there to override.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
TARGET_SR = 16_000
TARGET_SEC = 60.0
GAP_MS = 250

REPO = "FunAudioLLM/SenseVoiceSmall"
SAMPLES = {
    "en": "example/en.mp3",
    "zh": "example/zh.mp3",
    "ja": "example/ja.mp3",
    "ko": "example/ko.mp3",
}


def load_mono_16k(path: Path) -> np.ndarray:
    import librosa  # heavy import; defer until we actually fetch
    y, sr = librosa.load(str(path), sr=TARGET_SR, mono=True)
    return y.astype(np.float32)


def loop_to_duration(y: np.ndarray, target_sec: float) -> np.ndarray:
    target = int(target_sec * TARGET_SR)
    gap = np.zeros(int(GAP_MS / 1000 * TARGET_SR), dtype=np.float32)
    chunk = np.concatenate([y, gap])
    reps = int(np.ceil(target / len(chunk)))
    out = np.tile(chunk, reps)[:target]
    return out


def main() -> int:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    for lang, repo_path in SAMPLES.items():
        out = AUDIO_DIR / f"{lang}.wav"
        if out.exists():
            print(f"[{lang}] {out.name} already present, skipping fetch")
            continue
        print(f"[{lang}] fetching {REPO}/{repo_path} ...")
        try:
            local = hf_hub_download(repo_id=REPO, filename=repo_path,
                                    cache_dir=str(ROOT / "models" / "hf"))
        except Exception as e:
            print(f"[{lang}] fetch failed: {e}")
            print(f"  -> drop your own 16 kHz mono WAV at {out} and re-run.")
            return 1
        y = load_mono_16k(Path(local))
        y60 = loop_to_duration(y, TARGET_SEC)
        sf.write(str(out), y60, TARGET_SR, subtype="PCM_16")
        dur = len(y60) / TARGET_SR
        src_dur = len(y) / TARGET_SR
        print(f"[{lang}] wrote {out.name}: {dur:.2f}s ({src_dur:.2f}s clip looped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
