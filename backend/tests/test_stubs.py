"""Phase-2/3 routes that USED to be stubs:

  /v1/me                 — real, requires auth
  /v1/license            — real (reads subscriptions), requires auth
  /v1/license/refresh    — same
  /v1/billing/*          — real (phase 3); see test_billing.py for behaviour

Still deliberately stubbed (return 410 Gone):
  /v1/auth/start, /v1/auth/callback, /v1/auth/logout
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


def test_billing_checkout_requires_auth(client):
    # No longer a 501 stub — auth runs first, so an anonymous call is 401.
    assert client.post("/v1/billing/checkout").status_code == 401


def test_billing_portal_requires_auth(client):
    assert client.post("/v1/billing/portal").status_code == 401


def test_billing_endpoints_503_when_unconfigured(client, auth_headers):
    # conftest never sets STRIPE_* env, so billing is unconfigured.
    assert client.post(
        "/v1/billing/checkout", headers=auth_headers).status_code == 503
    assert client.post(
        "/v1/billing/portal", headers=auth_headers).status_code == 503


def test_billing_webhook_503_without_secret(client):
    # Signature header present (so we get past the 422), but no secret set.
    r = client.post(
        "/v1/billing/webhook", headers={"stripe-signature": "t=1,v1=x"},
    )
    assert r.status_code == 503, r.text


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
