"""/v1/billing/* — checkout, portal, webhook (phase 3, Stripe).

The Stripe SDK is mocked at the `services.stripe_billing` function level —
no real Stripe traffic. The webhook → `subscriptions` row → `/v1/license`
path is exercised for real against the test DB; only signature
verification (`parse_webhook_event`) is stubbed.
"""

from __future__ import annotations

from app.db import SessionLocal
from app.models.subscription import Subscription
from app.services import stripe_billing
from app.services.stripe_billing import StripeBillingError
from app.settings import get_settings

# A far-future unix timestamp for `current_period_end`.
_PERIOD_END_TS = 1900000000


def _enable_stripe(monkeypatch) -> None:
    """Flip the (lru-cached, process-wide) Settings into a configured state."""
    s = get_settings()
    monkeypatch.setattr(s, "stripe_secret_key", "sk_test_dummy")
    monkeypatch.setattr(s, "stripe_webhook_secret", "whsec_test_dummy")
    monkeypatch.setattr(s, "stripe_price_id_monthly", "price_monthly")
    monkeypatch.setattr(s, "stripe_price_id_annual", "price_annual")


def _user_id(client, auth_headers) -> int:
    return client.get("/v1/me", headers=auth_headers).json()["id"]


def _clear_subscription(user_id: int) -> None:
    db = SessionLocal()
    try:
        db.query(Subscription).filter(
            Subscription.user_id == user_id).delete()
        db.commit()
    finally:
        db.close()


# --- checkout ---------------------------------------------------------------


def test_checkout_returns_url(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)
    captured: dict = {}

    def fake_checkout(customer_id, price_id, success_url, cancel_url):
        captured["customer_id"] = customer_id
        captured["price_id"] = price_id
        return "https://checkout.stripe.test/sess_123"

    monkeypatch.setattr(
        stripe_billing, "ensure_customer", lambda db, user: "cus_test_abc")
    monkeypatch.setattr(stripe_billing, "create_checkout_session", fake_checkout)

    r = client.post(
        "/v1/billing/checkout", headers=auth_headers,
        json={"interval": "monthly"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://checkout.stripe.test/sess_123"
    assert captured == {"customer_id": "cus_test_abc", "price_id": "price_monthly"}


def test_checkout_defaults_to_monthly(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)
    captured: dict = {}
    monkeypatch.setattr(
        stripe_billing, "ensure_customer", lambda db, user: "cus_x")
    monkeypatch.setattr(
        stripe_billing, "create_checkout_session",
        lambda c, p, s, x: captured.setdefault("price_id", p) or "https://x",
    )
    r = client.post("/v1/billing/checkout", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert captured["price_id"] == "price_monthly"


def test_checkout_annual_unavailable_is_400(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)
    monkeypatch.setattr(get_settings(), "stripe_price_id_annual", "")
    monkeypatch.setattr(
        stripe_billing, "ensure_customer", lambda db, user: "cus_x")
    r = client.post(
        "/v1/billing/checkout", headers=auth_headers,
        json={"interval": "annual"},
    )
    assert r.status_code == 400, r.text


def test_checkout_stripe_failure_is_502(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)

    def boom(db, user):
        raise StripeBillingError("customer create failed: card_declined")

    monkeypatch.setattr(stripe_billing, "ensure_customer", boom)
    r = client.post("/v1/billing/checkout", headers=auth_headers)
    assert r.status_code == 502, r.text
    assert "could not start checkout" in r.json()["detail"]


# --- portal -----------------------------------------------------------------


def test_portal_409_without_subscription(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)
    _clear_subscription(_user_id(client, auth_headers))
    r = client.post("/v1/billing/portal", headers=auth_headers)
    assert r.status_code == 409, r.text


def test_portal_returns_url(client, auth_headers, monkeypatch):
    _enable_stripe(monkeypatch)
    uid = _user_id(client, auth_headers)
    _clear_subscription(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(user_id=uid, stripe_customer_id="cus_portal_test"))
        db.commit()
    finally:
        db.close()

    captured: dict = {}

    def fake_portal(customer_id, return_url):
        captured["customer_id"] = customer_id
        return "https://billing.stripe.test/portal_1"

    monkeypatch.setattr(stripe_billing, "create_portal_session", fake_portal)
    r = client.post("/v1/billing/portal", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://billing.stripe.test/portal_1"
    assert captured["customer_id"] == "cus_portal_test"


# --- webhook ----------------------------------------------------------------


def test_webhook_bad_signature_is_401(client, monkeypatch):
    _enable_stripe(monkeypatch)

    def reject(payload, sig):
        raise StripeBillingError("invalid webhook signature: bad sig")

    monkeypatch.setattr(stripe_billing, "parse_webhook_event", reject)
    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=bad"},
        content=b"{}",
    )
    assert r.status_code == 401, r.text


def test_webhook_subscription_created_flips_license_to_pro(
    client, auth_headers, monkeypatch,
):
    _enable_stripe(monkeypatch)
    uid = _user_id(client, auth_headers)
    # The /checkout path would have created this row; seed it directly.
    _clear_subscription(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(user_id=uid, stripe_customer_id="cus_webhook_test"))
        db.commit()
    finally:
        db.close()

    event = {
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": "sub_webhook_test",
                "customer": "cus_webhook_test",
                "status": "active",
                "cancel_at_period_end": False,
                "items": {
                    "data": [
                        {
                            "price": {"id": "price_monthly"},
                            "current_period_end": _PERIOD_END_TS,
                        },
                    ],
                },
            },
        },
    }
    monkeypatch.setattr(
        stripe_billing, "parse_webhook_event", lambda payload, sig: event)

    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=ok"},
        content=b"{}",
    )
    assert r.status_code == 200, r.text

    lic = client.get("/v1/license", headers=auth_headers).json()
    assert lic["plan"] == "pro"
    assert lic["active"] is True
    assert lic["status"] == "active"
    assert lic["current_period_end"] is not None


def test_webhook_subscription_deleted_drops_to_free(
    client, auth_headers, monkeypatch,
):
    _enable_stripe(monkeypatch)
    uid = _user_id(client, auth_headers)
    _clear_subscription(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(
            user_id=uid, stripe_customer_id="cus_del_test",
            stripe_subscription_id="sub_del_test",
            status="active", plan="pro", price_id="price_monthly",
        ))
        db.commit()
    finally:
        db.close()

    event = {
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "id": "sub_del_test",
                "customer": "cus_del_test",
                "status": "canceled",
                "cancel_at_period_end": False,
                "items": {"data": []},
            },
        },
    }
    monkeypatch.setattr(
        stripe_billing, "parse_webhook_event", lambda payload, sig: event)

    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=ok"},
        content=b"{}",
    )
    assert r.status_code == 200, r.text

    lic = client.get("/v1/license", headers=auth_headers).json()
    assert lic["plan"] == "free"
    assert lic["status"] == "canceled"


def test_webhook_checkout_completed_retrieves_subscription(
    client, auth_headers, monkeypatch,
):
    _enable_stripe(monkeypatch)
    uid = _user_id(client, auth_headers)
    _clear_subscription(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(user_id=uid, stripe_customer_id="cus_co_test"))
        db.commit()
    finally:
        db.close()

    event = {
        "type": "checkout.session.completed",
        "data": {"object": {"subscription": "sub_co_test", "customer": "cus_co_test"}},
    }
    retrieved = {
        "id": "sub_co_test",
        "customer": "cus_co_test",
        "status": "active",
        "cancel_at_period_end": False,
        "items": {
            "data": [
                {"price": {"id": "price_monthly"},
                 "current_period_end": _PERIOD_END_TS},
            ],
        },
    }
    monkeypatch.setattr(
        stripe_billing, "parse_webhook_event", lambda payload, sig: event)
    monkeypatch.setattr(
        stripe_billing, "retrieve_subscription", lambda sid: retrieved)

    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=ok"},
        content=b"{}",
    )
    assert r.status_code == 200, r.text

    lic = client.get("/v1/license", headers=auth_headers).json()
    assert lic["plan"] == "pro"


def test_webhook_accepts_real_stripe_object_payload(
    client, auth_headers, monkeypatch,
):
    """Regression: real Stripe webhooks deliver `StripeObject`, not plain dicts.
    `StripeObject.get(...)` raises AttributeError because attribute access goes
    through `__getattr__`. parse_webhook_event must normalize to a dict so the
    routers + upsert don't 500. The unit-mocked event dicts above DIDN'T catch
    this — the real-env e2e on 2026-05-15 did."""
    from stripe._stripe_object import StripeObject

    _enable_stripe(monkeypatch)
    uid = _user_id(client, auth_headers)
    _clear_subscription(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(user_id=uid, stripe_customer_id="cus_so_test"))
        db.commit()
    finally:
        db.close()

    # Build a StripeObject the way the SDK does after construct_event().
    real_event = StripeObject.construct_from({
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": "sub_so_test",
                "customer": "cus_so_test",
                "status": "active",
                "cancel_at_period_end": False,
                "items": {
                    "data": [
                        {
                            "price": {"id": "price_monthly"},
                            "current_period_end": _PERIOD_END_TS,
                        },
                    ],
                },
            },
        },
    }, "sk_test_dummy")
    assert not isinstance(real_event, dict)  # would defeat the test otherwise

    monkeypatch.setattr(
        stripe_billing, "parse_webhook_event",
        # Route through the actual normalizer, not just `lambda: dict_payload`.
        lambda payload, sig: stripe_billing._as_dict(real_event),
    )
    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=ok"},
        content=b"{}",
    )
    assert r.status_code == 200, r.text
    lic = client.get("/v1/license", headers=auth_headers).json()
    assert lic["plan"] == "pro"


def test_webhook_unhandled_event_is_acked(client, monkeypatch):
    _enable_stripe(monkeypatch)
    event = {"type": "invoice.paid", "data": {"object": {}}}
    monkeypatch.setattr(
        stripe_billing, "parse_webhook_event", lambda payload, sig: event)
    r = client.post(
        "/v1/billing/webhook",
        headers={"stripe-signature": "t=1,v1=ok"},
        content=b"{}",
    )
    assert r.status_code == 200, r.text
