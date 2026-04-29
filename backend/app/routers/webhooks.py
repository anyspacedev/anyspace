"""Clerk webhook handler.

Clerk fans out user lifecycle events through Svix. Every payload is signed;
we verify with the signing secret from the dashboard before touching the
DB. Events handled:

  * user.created  — INSERT mirror row
  * user.updated  — UPDATE email / clear deleted_at
  * user.deleted  — soft-delete (sets deleted_at; subsequent JWTs 401)

Anything else is acknowledged with 200 so Clerk doesn't retry.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy.orm import Session
from svix.webhooks import Webhook, WebhookVerificationError

from ..db import SessionLocal
from ..logging import log
from ..models.user import User
from ..settings import get_settings

router = APIRouter(prefix="/webhooks")


def _primary_email(payload: dict) -> str | None:
    data = payload.get("data") or {}
    pid = data.get("primary_email_address_id")
    for e in data.get("email_addresses") or []:
        if e.get("id") == pid:
            return e.get("email_address")
    # Fall back: first email in the list, if any.
    if data.get("email_addresses"):
        return data["email_addresses"][0].get("email_address")
    return None


def _upsert(db: Session, clerk_user_id: str, email: str | None,
            *, deleted: bool = False) -> None:
    user = (db.query(User)
              .filter(User.clerk_user_id == clerk_user_id)
              .one_or_none())
    if user is None:
        user = User(clerk_user_id=clerk_user_id, email=email)
        if deleted:
            user.deleted_at = datetime.utcnow()
        db.add(user)
    else:
        if email and user.email != email:
            user.email = email
        user.deleted_at = datetime.utcnow() if deleted else None
        user.updated_at = datetime.utcnow()
    db.commit()


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    svix_id: str = Header(..., alias="svix-id"),
    svix_timestamp: str = Header(..., alias="svix-timestamp"),
    svix_signature: str = Header(..., alias="svix-signature"),
) -> dict:
    settings = get_settings()
    if not settings.clerk_webhook_signing_secret:
        # Refuse to accept webhooks until the secret is configured —
        # otherwise any caller could spoof user lifecycle events.
        raise HTTPException(503, "webhook secret not configured")

    body = await request.body()
    headers = {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
    }
    try:
        payload = Webhook(
            settings.clerk_webhook_signing_secret
        ).verify(body, headers)
    except WebhookVerificationError as e:
        raise HTTPException(401, f"invalid signature: {e}") from e

    event_type = payload.get("type", "")
    data = payload.get("data") or {}
    clerk_user_id = data.get("id")
    if not clerk_user_id:
        # Some event types don't carry an id; ack and ignore.
        log.info("clerk.webhook.skipped", event_type=event_type)
        return {"ok": True}

    db = SessionLocal()
    try:
        if event_type == "user.created":
            _upsert(db, clerk_user_id, _primary_email(payload))
        elif event_type == "user.updated":
            _upsert(db, clerk_user_id, _primary_email(payload))
        elif event_type == "user.deleted":
            _upsert(db, clerk_user_id, None, deleted=True)
        else:
            log.info("clerk.webhook.unhandled", event_type=event_type)
            return {"ok": True}
    finally:
        db.close()

    log.info(
        "clerk.webhook.applied",
        event_type=event_type, clerk_user_id=clerk_user_id,
    )
    return {"ok": True}
