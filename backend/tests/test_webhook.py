"""Clerk webhook handler tests."""

from __future__ import annotations

import json

from svix.webhooks import Webhook


SIGNING_SECRET = "whsec_dGVzdC1zZWNyZXQ="  # matches conftest


def _signed(body: dict, msg_id: str = "msg_test_1"):
    """Sign a JSON body the way Svix does, return body bytes + headers.

    svix.Webhook.sign returns just the signature *string*; we have to build
    the header dict ourselves with svix-id / svix-timestamp / svix-signature.
    """
    from datetime import datetime, timezone
    raw_str = json.dumps(body)
    raw = raw_str.encode()
    ts = datetime.now(tz=timezone.utc)
    sig = Webhook(SIGNING_SECRET).sign(msg_id, ts, raw_str)
    headers = {
        "svix-id": msg_id,
        "svix-timestamp": str(int(ts.timestamp())),
        "svix-signature": sig,
    }
    return raw, headers


def test_unsigned_request_rejected(client):
    r = client.post(
        "/webhooks/clerk",
        json={"type": "user.created", "data": {"id": "x"}},
    )
    # FastAPI rejects with 422 because required Svix headers are missing.
    assert r.status_code in (401, 422)


def test_user_created_then_deleted_flow(client):
    body = {
        "type": "user.created",
        "data": {
            "id": "user_clerk_42",
            "primary_email_address_id": "ema_1",
            "email_addresses": [
                {"id": "ema_1", "email_address": "carol@example.com"},
            ],
        },
    }
    raw, headers = _signed(body)
    r = client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 200, r.text

    # User row exists.
    from app.db import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    try:
        user = (db.query(User)
                  .filter(User.clerk_user_id == "user_clerk_42").one())
        assert user.email == "carol@example.com"
        assert user.deleted_at is None
    finally:
        db.close()

    # user.deleted soft-deletes.
    body = {"type": "user.deleted", "data": {"id": "user_clerk_42"}}
    raw, headers = _signed(body, msg_id="msg_test_2")
    r = client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 200

    db = SessionLocal()
    try:
        user = (db.query(User)
                  .filter(User.clerk_user_id == "user_clerk_42").one())
        assert user.deleted_at is not None
    finally:
        db.close()


def test_unhandled_event_acked(client):
    body = {"type": "session.created", "data": {"id": "sess_1"}}
    raw, headers = _signed(body)
    r = client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 200
