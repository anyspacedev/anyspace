"""Account + license routes.

Auth itself happens in the Clerk client SDK (sign-in modal in the desktop
app, hosted pages on the marketing site). The backend only exposes:

  * GET  /v1/me       — current user, derived from the verified JWT
  * GET  /v1/license  — subscription state placeholder until Stripe lands
  * POST /v1/license/refresh — same shape; reserved for forced re-check
  * POST /v1/auth/*   — return 410 Gone; clients should not call these
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models.subscription import Subscription
from ..models.user import User

router = APIRouter(prefix="/v1")

# Stripe statuses that still entitle Pro access (mirrors stripe_billing).
_ACTIVE_STATUSES = {"active", "trialing", "past_due"}


def _gone() -> JSONResponse:
    return JSONResponse(
        status_code=410,
        content={
            "detail": (
                "Auth flows are handled by the Clerk client SDK. Sign in "
                "via the desktop app or marketing site; this endpoint is not used."
            ),
        },
    )


@router.post("/auth/start")
def auth_start() -> JSONResponse:
    return _gone()


@router.post("/auth/callback")
def auth_callback() -> JSONResponse:
    return _gone()


@router.post("/auth/logout")
def auth_logout() -> JSONResponse:
    return _gone()


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return {
        "id": user.id,
        "clerk_user_id": user.clerk_user_id,
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }


def _license_for(db: Session, user: User) -> dict:
    """Subscription state, read from the Stripe-mirrored `subscriptions` row.

    No row, or a row dropped back to `plan == "free"` (e.g. after a
    cancellation), means Free. The Stripe webhook keeps the row current, so
    `refresh` is just a re-read — no forced Stripe round-trip needed.
    """
    sub = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id)
        .one_or_none()
    )
    if sub is None or sub.plan == "free":
        return {
            "user_id": user.id,
            "plan": "free",
            "active": True,
            "status": sub.status if sub else "free",
            "current_period_end": None,
            "cancel_at_period_end": False,
        }
    return {
        "user_id": user.id,
        "plan": sub.plan,
        "active": sub.status in _ACTIVE_STATUSES,
        "status": sub.status,
        "current_period_end": (
            sub.current_period_end.isoformat()
            if sub.current_period_end else None
        ),
        "cancel_at_period_end": sub.cancel_at_period_end,
    }


@router.get("/license")
def license_get(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _license_for(db, user)


@router.post("/license/refresh")
def license_refresh(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    return _license_for(db, user)
