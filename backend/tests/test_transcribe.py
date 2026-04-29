"""Transcription endpoint tests.

Phase 2: auth required. Anonymous calls 401; authed calls hit the stub
recognizer (real model only in `slow` tests).
"""

from __future__ import annotations

import io
import os
import wave
from pathlib import Path

import numpy as np
import pytest


def _silent_wav_bytes(seconds: float, sr: int = 16000) -> bytes:
    samples = np.zeros(int(seconds * sr), dtype=np.int16).tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples)
    return buf.getvalue()


def test_anonymous_transcribe_returns_401(client):
    wav = _silent_wav_bytes(0.5)
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", wav, "audio/wav")},
    )
    assert r.status_code == 401, r.text
    assert "missing bearer token" in r.json()["detail"]


def test_invalid_jwt_returns_401(client_anon, auth_headers):
    wav = _silent_wav_bytes(0.5)
    r = client_anon.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", wav, "audio/wav")},
        headers=auth_headers,
    )
    assert r.status_code == 401
    assert "invalid token" in r.json()["detail"]


def test_authed_transcribe_with_stub(client, auth_headers):
    wav = _silent_wav_bytes(1.5)
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", wav, "audio/wav")},
        data={"language": "en"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "[stub]" in body["text"]
    assert body["audio_sec"] == pytest.approx(1.5, abs=0.05)
    assert body["lang_hint"] == "en"


def test_authed_empty_file_400(client, auth_headers):
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"", "audio/wav")},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_unsupported_response_format_400(client, auth_headers):
    wav = _silent_wav_bytes(0.5)
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", wav, "audio/wav")},
        data={"response_format": "verbose_json"},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_rate_limit_kicks_in(client, auth_headers):
    """RATE_LIMIT_PER_MIN=5 in conftest → 6th request must be 429."""
    wav = _silent_wav_bytes(0.5)
    statuses = []
    for _ in range(7):
        r = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("a.wav", wav, "audio/wav")},
            headers=auth_headers,
        )
        statuses.append(r.status_code)
    assert statuses.count(200) == 5, statuses
    assert statuses[-1] == 429, statuses


def test_audit_log_records_user_id(client, auth_headers):
    """Verifies the FK from audit_log → users gets populated."""
    wav = _silent_wav_bytes(0.5)
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", wav, "audio/wav")},
        headers=auth_headers,
    )
    assert r.status_code == 200
    # Now read back via the test DB.
    from app.db import SessionLocal
    from app.models.audit_log import AuditLog
    from app.models.user import User
    db = SessionLocal()
    try:
        user = db.query(User).filter(
            User.clerk_user_id == "user_test_alice"
        ).one()
        last = (db.query(AuditLog)
                  .order_by(AuditLog.id.desc())
                  .first())
        assert last is not None
        assert last.user_id == user.id
    finally:
        db.close()


@pytest.mark.slow
def test_transcribe_real_model_en():
    """Hits the real sherpa-onnx model. Skipped unless the wav is on disk."""
    audio = Path(__file__).resolve().parent.parent.parent / "ast-test/audio/en.wav"
    if not audio.exists() or os.environ.get("SKIP_SLOW") == "1":
        pytest.skip("real model test skipped")
    from app import main as main_module
    from app import deps as deps_module
    from app.services import clerk as clerk_module
    from fastapi.testclient import TestClient

    # Patch the verifier directly on the modules — slow tests don't go
    # through the `client` fixture's monkeypatch.
    real_verify = clerk_module.verify_clerk_jwt
    real_verify_deps = deps_module.verify_clerk_jwt
    clerk_module.verify_clerk_jwt = lambda _t: {"sub": "slow-user", "email": None}
    deps_module.verify_clerk_jwt = clerk_module.verify_clerk_jwt
    try:
        with TestClient(main_module.create_app()) as c:
            with audio.open("rb") as f:
                r = c.post(
                    "/v1/audio/transcriptions",
                    files={"file": (audio.name, f.read(), "audio/wav")},
                    data={"language": "en"},
                    headers={"Authorization": "Bearer x"},
                )
        assert r.status_code == 200
        assert r.json()["text"]
    finally:
        clerk_module.verify_clerk_jwt = real_verify
        deps_module.verify_clerk_jwt = real_verify_deps
