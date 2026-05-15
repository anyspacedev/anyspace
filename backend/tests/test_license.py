"""/v1/license — reads subscription state from the `subscriptions` table.

These tests manipulate the `subscriptions` row directly (the webhook path
that writes it is covered in test_billing.py) and clean up first so they
don't depend on test ordering against the session-shared SQLite DB.
"""

from __future__ import annotations

from app.db import SessionLocal
from app.models.subscription import Subscription


def _user_id(client, auth_headers) -> int:
    return client.get("/v1/me", headers=auth_headers).json()["id"]


def _reset_subscription(user_id: int, **fields) -> None:
    db = SessionLocal()
    try:
        db.query(Subscription).filter(
            Subscription.user_id == user_id).delete()
        if fields:
            db.add(Subscription(user_id=user_id, **fields))
        db.commit()
    finally:
        db.close()


def test_license_free_when_no_row(client, auth_headers):
    uid = _user_id(client, auth_headers)
    _reset_subscription(uid)

    body = client.get("/v1/license", headers=auth_headers).json()
    assert body["plan"] == "free"
    assert body["active"] is True
    assert body["current_period_end"] is None
    assert body["cancel_at_period_end"] is False
    # trial_ends_at was dropped in phase 3 — must not reappear.
    assert "trial_ends_at" not in body


def test_license_pro_when_active_subscription(client, auth_headers):
    uid = _user_id(client, auth_headers)
    _reset_subscription(
        uid,
        stripe_customer_id="cus_license_test",
        stripe_subscription_id="sub_license_test",
        status="active",
        plan="pro",
        price_id="price_monthly",
        cancel_at_period_end=False,
    )

    body = client.get("/v1/license", headers=auth_headers).json()
    assert body["plan"] == "pro"
    assert body["active"] is True
    assert body["status"] == "active"


def test_license_free_when_subscription_canceled(client, auth_headers):
    # A canceled subscription keeps its row but drops plan back to free.
    uid = _user_id(client, auth_headers)
    _reset_subscription(
        uid,
        stripe_customer_id="cus_license_test",
        status="canceled",
        plan="free",
    )

    body = client.get("/v1/license", headers=auth_headers).json()
    assert body["plan"] == "free"
    assert body["status"] == "canceled"


def test_license_refresh_matches_get(client, auth_headers):
    uid = _user_id(client, auth_headers)
    _reset_subscription(
        uid,
        stripe_customer_id="cus_license_test",
        status="active",
        plan="pro",
        price_id="price_monthly",
    )

    got = client.get("/v1/license", headers=auth_headers).json()
    refreshed = client.post("/v1/license/refresh", headers=auth_headers).json()
    assert got == refreshed
