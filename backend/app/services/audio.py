"""Decode any browser-emitted blob (webm/opus, ogg, mp4, wav...) to 16 kHz
mono float32 samples via ffmpeg subprocess. Lifted from
ast-test/scripts/server.py:decode_to_wav_pcm.
"""

from __future__ import annotations

import io
import subprocess
import wave

import numpy as np


class AudioDecodeError(Exception):
    pass


def decode_to_pcm(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error",
         "-i", "pipe:0", "-ar", "16000", "-ac", "1",
         "-f", "wav", "pipe:1"],
        input=audio_bytes, capture_output=True,
    )
    if proc.returncode != 0:
        raise AudioDecodeError(
            f"ffmpeg decode failed: {proc.stderr.decode(errors='replace')[:500]}"
        )
    with wave.open(io.BytesIO(proc.stdout), "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sr
