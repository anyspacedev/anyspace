"""Shared test fixtures.

Each test gets a temp SQLite database (isolated; never pollutes data/) and
a TestClient that runs FastAPI lifespan. To keep `pytest -m 'not slow'`
fast, the recognizer is replaced with a stub and the Clerk JWT verifier
is monkeypatched to return canned claims — tests that need to assert on
the real verifier mock the JWKS endpoint at the httpx level.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Force settings BEFORE we import the app — pydantic-settings reads env at
# import time via lru_cache.
TMP_DB = Path("/tmp") / "teamship-test.db"
if TMP_DB.exists():
    TMP_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TMP_DB}"
os.environ["LOG_LEVEL"] = "warning"
os.environ["RATE_LIMIT_PER_MIN"] = "5"
os.environ["RATE_LIMIT_PER_HOUR"] = "20"
os.environ["CLERK_FRONTEND_API"] = "https://test.clerk.example"
os.environ["CLERK_WEBHOOK_SIGNING_SECRET"] = "whsec_dGVzdC1zZWNyZXQ="  # base64 "test-secret"


def _apply_migrations() -> None:
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(
        Path(__file__).resolve().parent.parent / "alembic"))
    command.upgrade(cfg, "head")


_apply_migrations()


class _FakeRecognizer:
    def create_stream(self):
        return self

    def accept_waveform(self, sample_rate, waveform):
        self._n = len(waveform)

    def decode_stream(self, _stream):
        pass

    @property
    def result(self):
        return type("R", (), {"text": f"[stub] decoded {self._n} samples"})()


# Canned claim set the patched verifier returns. Tests can override per-test
# by reassigning this dict's contents.
DEFAULT_CLAIMS = {
    "sub": "user_test_alice",
    "email": "alice@example.com",
}


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test-token-anything"}


@pytest.fixture
def client(monkeypatch):
    # Stub the recognizer.
    from app.services import asr as asr_module
    monkeypatch.setattr(asr_module, "build_recognizer",
                        lambda: _FakeRecognizer())
    from app import main as main_module
    monkeypatch.setattr(main_module, "build_recognizer",
                        lambda: _FakeRecognizer())

    # Stub the JWT verifier — a real test harness for the verifier itself
    # belongs in test_clerk.py with its own JWKS mock.
    from app.services import clerk as clerk_module
    from app import deps as deps_module
    monkeypatch.setattr(deps_module, "verify_clerk_jwt",
                        lambda token: dict(DEFAULT_CLAIMS))
    monkeypatch.setattr(clerk_module, "verify_clerk_jwt",
                        lambda token: dict(DEFAULT_CLAIMS))

    # Reset the rate limiter so each test starts fresh.
    from app.services import ratelimit
    ratelimit._limiter = None

    with TestClient(main_module.app) as c:
        yield c


@pytest.fixture
def client_anon(monkeypatch):
    """Same as `client` but the JWT verifier always rejects — for testing the
    401 path."""
    from app.services import asr as asr_module
    monkeypatch.setattr(asr_module, "build_recognizer",
                        lambda: _FakeRecognizer())
    from app import main as main_module
    monkeypatch.setattr(main_module, "build_recognizer",
                        lambda: _FakeRecognizer())

    from app.services import clerk as clerk_module
    from app import deps as deps_module

    def _reject(_token):
        from app.services.clerk import JWTValidationError
        raise JWTValidationError("test-reject")

    monkeypatch.setattr(deps_module, "verify_clerk_jwt", _reject)
    monkeypatch.setattr(clerk_module, "verify_clerk_jwt", _reject)

    from app.services import ratelimit
    ratelimit._limiter = None

    with TestClient(main_module.app) as c:
        yield c
