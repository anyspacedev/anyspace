"""Phase-2 routes that USED to be stubs:

  /v1/me                 — now real, requires auth
  /v1/license            — now placeholder, requires auth
  /v1/license/refresh    — same

Still phase-2-incomplete (return 410 Gone, deliberately):
  /v1/auth/start, /v1/auth/callback, /v1/auth/logout

Still phase-3-pending (501):
  /v1/billing/*
"""

import pytest


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/v1/auth/start"),
        ("post", "/v1/auth/callback"),
        ("post", "/v1/auth/logout"),
    ],
)
def test_auth_routes_return_410(client, method, path):
    r = getattr(client, method)(path)
    assert r.status_code == 410, (path, r.text)
    body = r.json()
    assert "Clerk client SDK" in body["detail"]


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/v1/billing/checkout"),
        ("post", "/v1/billing/portal"),
        ("post", "/v1/billing/webhook"),
    ],
)
def test_billing_routes_return_501(client, method, path):
    r = getattr(client, method)(path)
    assert r.status_code == 501, (path, r.text)


def test_me_requires_auth(client):
    r = client.get("/v1/me")
    assert r.status_code == 401


def test_me_returns_user(client, auth_headers):
    r = client.get("/v1/me", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["clerk_user_id"] == "user_test_alice"
    assert body["email"] == "alice@example.com"
    assert isinstance(body["id"], int)


def test_license_requires_auth(client):
    r = client.get("/v1/license")
    assert r.status_code == 401


def test_license_free_tier(client, auth_headers):
    r = client.get("/v1/license", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert body["active"] is True
    assert body["trial_ends_at"] is None
