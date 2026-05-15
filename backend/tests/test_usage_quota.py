"""Quota enforcement tests.

Drives the `/v1/chat/completions` + `/v1/audio/transcriptions` paths through
the `check_or_raise` gate, plus the `/v1/usage` read endpoint.

The chat/transcribe upstreams are NOT exercised here — we stub them out so
the test cares only about the 402 path. The unit-level `check_or_raise`
behaviour is also covered directly (no router involvement) for the edge cases.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.subscription import Subscription
from app.services import usage_quota
from app.settings import get_settings


# --- fixtures / helpers -----------------------------------------------------


def _user_id(client, auth_headers) -> int:
    return client.get("/v1/me", headers=auth_headers).json()["id"]


def _wipe(uid: int) -> None:
    """Reset the user's quota state between cases (shared session DB)."""
    db = SessionLocal()
    try:
        db.query(AuditLog).filter(AuditLog.user_id == uid).delete()
        db.query(Subscription).filter(Subscription.user_id == uid).delete()
        db.commit()
    finally:
        db.close()


def _seed_audit(uid: int, *, kind: str, count: int = 1, audio_sec: float = 0.0,
                status: int = 200, when: datetime | None = None) -> None:
    """Insert N audit_log rows for the user. `kind` is 'ai' or 'stt'."""
    path = ("/v1/chat/completions" if kind == "ai"
            else "/v1/audio/transcriptions")
    db = SessionLocal()
    try:
        for _ in range(count):
            db.add(AuditLog(
                ip="127.0.0.1", path=path, status=status, user_id=uid,
                audio_sec=audio_sec if kind == "stt" else None,
                created_at=when or datetime.utcnow(),
            ))
        db.commit()
    finally:
        db.close()


def _seed_pro(uid: int, *, days_into_period: int = 5) -> None:
    """Mark the user as active Pro with a fresh billing period."""
    now = datetime.utcnow()
    db = SessionLocal()
    try:
        db.query(Subscription).filter(Subscription.user_id == uid).delete()
        db.add(Subscription(
            user_id=uid,
            stripe_customer_id="cus_quota_test",
            stripe_subscription_id="sub_quota_test",
            status="active",
            plan="pro",
            price_id="price_monthly",
            current_period_start=now - timedelta(days=days_into_period),
            current_period_end=now + timedelta(days=30 - days_into_period),
        ))
        db.commit()
    finally:
        db.close()


# --- unit-level: check_or_raise --------------------------------------------


def test_free_user_under_cap_passes(client, auth_headers):
    """Sanity: under-limit Free user → no exception, snapshot reflects usage."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    _seed_audit(uid, kind="ai", count=10)

    snap = client.get("/v1/usage", headers=auth_headers).json()
    assert snap["plan"] == "free"
    assert snap["ai"]["used"] == 10
    assert snap["ai"]["limit"] == get_settings().free_quota_ai_per_month
    assert snap["stt"]["used_sec"] == 0


def test_free_user_at_ai_cap_returns_402(client, auth_headers):
    """At the cap → 402 with structured body; upgrade_url present."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    _seed_audit(uid, kind="ai", count=get_settings().free_quota_ai_per_month)

    r = client.post(
        "/v1/chat/completions", headers=auth_headers,
        json={"model": "anyspace-default", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 402, r.text
    body = r.json()["detail"]
    assert body["plan"] == "free"
    assert body["quota_kind"] == "ai"
    assert body["limit"] == get_settings().free_quota_ai_per_month
    assert body["used"] >= body["limit"]
    assert body["upgrade_url"] == "/v1/billing/checkout"
    assert body["resets_at"].endswith("Z")


def test_free_user_at_stt_cap_returns_402(client, auth_headers):
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    # Seed one row consuming the full Free STT allowance.
    _seed_audit(uid, kind="stt", count=1,
                audio_sec=float(get_settings().free_quota_stt_secs_per_month))

    r = client.post(
        "/v1/audio/transcriptions", headers=auth_headers,
        files={"file": ("a.wav", b"\x00\x00", "audio/wav")},
    )
    assert r.status_code == 402, r.text
    body = r.json()["detail"]
    assert body["quota_kind"] == "stt"
    assert body["plan"] == "free"


def test_failed_requests_dont_count(client, auth_headers):
    """audit_log rows with status>=500 don't bill — Free user shouldn't be
    locked out by upstream LLM failures the gateway logged as 5xx."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    # Seed cap-many rows, but all 502 (upstream failures).
    _seed_audit(uid, kind="ai",
                count=get_settings().free_quota_ai_per_month, status=502)

    snap = client.get("/v1/usage", headers=auth_headers).json()
    assert snap["ai"]["used"] == 0


def test_usage_outside_window_doesnt_count(client, auth_headers):
    """A row stamped in last month must not count against this month's quota."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    now = datetime.utcnow()
    last_month = datetime(now.year, now.month, 1) - timedelta(days=1)
    _seed_audit(uid, kind="ai", count=500, when=last_month)

    snap = client.get("/v1/usage", headers=auth_headers).json()
    assert snap["ai"]["used"] == 0


def test_pro_user_under_quiet_cap_passes(client, auth_headers):
    """Pro under the fair-use ceiling → snapshot exposes the Pro caps, usage
    counts the current billing period only."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    _seed_pro(uid)
    _seed_audit(uid, kind="ai", count=50)

    snap = client.get("/v1/usage", headers=auth_headers).json()
    assert snap["plan"] == "pro"
    assert snap["ai"]["limit"] == get_settings().pro_quota_ai_per_period
    assert snap["ai"]["used"] == 50


def test_pro_user_over_quiet_cap_returns_402_pro_abuse(client, auth_headers):
    """Pro past the quiet ceiling → 402 with quota_kind='pro_abuse' and a
    'reach out at hi@anyspace.dev' message (no upgrade affordance — they
    already paid us)."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    _seed_pro(uid)
    _seed_audit(uid, kind="ai", count=get_settings().pro_quota_ai_per_period)

    r = client.post(
        "/v1/chat/completions", headers=auth_headers,
        json={"model": "anyspace-default", "messages": [{"role": "user", "content": "x"}]},
    )
    assert r.status_code == 402, r.text
    body = r.json()["detail"]
    assert body["quota_kind"] == "pro_abuse"
    assert body["plan"] == "pro"
    assert "hi@anyspace.dev" in body["detail"]


def test_pro_with_unpopulated_period_falls_back_to_free_window(
    client, auth_headers,
):
    """Race: subscription row exists with plan='pro' but the webhook hasn't
    yet populated current_period_{start,end} — be lenient, treat as Free
    window so we don't 402 a fresh Pro user we haven't billed yet."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    db = SessionLocal()
    try:
        db.add(Subscription(
            user_id=uid, stripe_customer_id="cus_race",
            stripe_subscription_id="sub_race",
            status="active", plan="pro", price_id="price_monthly",
            current_period_start=None, current_period_end=None,
        ))
        db.commit()
    finally:
        db.close()

    snap = client.get("/v1/usage", headers=auth_headers).json()
    # No period_{start,end} → window_for() falls back to calendar month + Free
    # caps. The /v1/usage and check_or_raise should agree.
    assert snap["plan"] == "free"
    assert snap["ai"]["limit"] == get_settings().free_quota_ai_per_month


# --- /v1/usage endpoint ------------------------------------------------------


def test_usage_endpoint_requires_auth(client):
    assert client.get("/v1/usage").status_code == 401


def test_usage_endpoint_window_shape(client, auth_headers):
    """Window timestamps are ISO-Z and represent the calendar month for Free."""
    uid = _user_id(client, auth_headers)
    _wipe(uid)
    snap = client.get("/v1/usage", headers=auth_headers).json()
    assert snap["window_start"].endswith("Z")
    assert snap["window_end"].endswith("Z")
    # window starts at first-of-month UTC.
    assert snap["window_start"].endswith("T00:00:00Z")
    # Day-1 only.
    assert "-01T00:00:00Z" in snap["window_start"]


# --- unit-level helper coverage ---------------------------------------------


@pytest.mark.parametrize("month,expected", [
    (1, "2026-02-01"), (12, "2027-01-01"), (6, "2026-07-01"),
])
def test_start_of_next_month_wraps_year(month: int, expected: str):
    """Internal helper: December rolls to January of the next year."""
    out = usage_quota._start_of_next_month(datetime(2026, month, 1))
    assert out.strftime("%Y-%m-%d") == expected
