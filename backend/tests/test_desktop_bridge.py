"""Tests for /v1/desktop-bridge/mint-ticket.

Auth flow is covered by the standard `client` / `client_anon` fixtures
(JWT verifier monkeypatched). The Clerk Backend API call is mocked at
the service-function level — no real httpx traffic.
"""

from __future__ import annotations

import pytest

from app.services.clerk_backend import ClerkBackendError


def test_mint_ticket_returns_ticket_for_signed_in_user(
    client, auth_headers, monkeypatch
):
    """Happy path: signed-in caller → Clerk mints a token → we return it."""
    captured: dict = {}

    def fake_mint(user_id, expires_in_seconds=60):
        captured["user_id"] = user_id
        captured["ttl"] = expires_in_seconds
        return "sit_fake_ticket_value"

    # Patch the symbol the router imported, not the source module — the
    # router did `from ..services.clerk_backend import mint_sign_in_token`,
    # so its local binding is what gets called.
    from app.routers import desktop_bridge as router_module
    monkeypatch.setattr(router_module, "mint_sign_in_token", fake_mint)

    r = client.post("/v1/desktop-bridge/mint-ticket", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"ticket": "sit_fake_ticket_value"}
    # The DEFAULT_CLAIMS fixture uses user_test_alice; the route should
    # have asked Clerk to mint a ticket for that user, not some other one.
    assert captured["user_id"] == "user_test_alice"
    assert captured["ttl"] == 60


def test_mint_ticket_requires_auth(client_anon):
    """No bearer → 401, never reaches the Clerk Backend API."""
    r = client_anon.post("/v1/desktop-bridge/mint-ticket")
    assert r.status_code == 401, r.text


def test_mint_ticket_rejects_bad_bearer(client_anon):
    """Bearer present but JWT verifier rejects → 401."""
    r = client_anon.post(
        "/v1/desktop-bridge/mint-ticket",
        headers={"Authorization": "Bearer garbage"},
    )
    assert r.status_code == 401, r.text


def test_mint_ticket_502_when_clerk_fails(client, auth_headers, monkeypatch):
    """Upstream Clerk error surfaces as 502, not 500 — the request was
    well-formed, the upstream couldn't fulfill it."""

    def boom(user_id, expires_in_seconds=60):
        raise ClerkBackendError("clerk responded 500: oops")

    from app.routers import desktop_bridge as router_module
    monkeypatch.setattr(router_module, "mint_sign_in_token", boom)

    r = client.post("/v1/desktop-bridge/mint-ticket", headers=auth_headers)
    assert r.status_code == 502, r.text
    assert "could not mint sign-in ticket" in r.json()["detail"]


def test_mint_ticket_502_when_secret_key_missing(client, auth_headers, monkeypatch):
    """If CLERK_SECRET_KEY is unset, the service raises ClerkBackendError
    before any HTTP call — same 502 path."""

    def missing_key(user_id, expires_in_seconds=60):
        raise ClerkBackendError("CLERK_SECRET_KEY not configured")

    from app.routers import desktop_bridge as router_module
    monkeypatch.setattr(router_module, "mint_sign_in_token", missing_key)

    r = client.post("/v1/desktop-bridge/mint-ticket", headers=auth_headers)
    assert r.status_code == 502
    assert "CLERK_SECRET_KEY" in r.json()["detail"]


# --- Service-level tests (httpx-mocked, no FastAPI involved) ---


def test_service_calls_clerk_with_expected_payload(monkeypatch):
    """Confirms the request shape sent to Clerk: bearer header, correct
    URL, JSON body with user_id + TTL. The route's contract depends on
    this being right."""
    from app.services import clerk_backend as svc

    captured = {}

    class FakeResp:
        status_code = 200
        text = ""

        def json(self):
            return {"object": "token", "token": "sit_abc", "status": "pending"}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResp()

    monkeypatch.setattr(svc.httpx, "post", fake_post)
    # Settings.clerk_secret_key is "" in tests; set it for this case.
    from app.settings import get_settings
    get_settings().clerk_secret_key = "sk_test_abc"  # type: ignore[misc]
    try:
        out = svc.mint_sign_in_token("user_x", expires_in_seconds=42)
    finally:
        get_settings().clerk_secret_key = ""  # type: ignore[misc]

    assert out == "sit_abc"
    assert captured["url"].endswith("/sign_in_tokens")
    assert captured["headers"]["Authorization"] == "Bearer sk_test_abc"
    assert captured["json"] == {"user_id": "user_x", "expires_in_seconds": 42}


def test_service_raises_on_non_2xx(monkeypatch):
    from app.services import clerk_backend as svc

    class FakeResp:
        status_code = 422
        text = '{"errors":[{"code":"resource_not_found"}]}'

        def json(self):
            return {}

    monkeypatch.setattr(svc.httpx, "post", lambda *a, **kw: FakeResp())
    from app.settings import get_settings
    get_settings().clerk_secret_key = "sk_test_abc"  # type: ignore[misc]
    try:
        with pytest.raises(ClerkBackendError, match="422"):
            svc.mint_sign_in_token("user_nope")
    finally:
        get_settings().clerk_secret_key = ""  # type: ignore[misc]


def test_service_raises_when_secret_unset(monkeypatch):
    from app.services import clerk_backend as svc
    from app.settings import get_settings

    # In conftest CLERK_SECRET_KEY is never set, so this is the default.
    assert get_settings().clerk_secret_key == ""
    with pytest.raises(ClerkBackendError, match="CLERK_SECRET_KEY"):
        svc.mint_sign_in_token("user_x")
