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

from ..deps import current_user
from ..models.user import User

router = APIRouter(prefix="/v1")


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


def _free_tier_license(user: User) -> dict:
    """Phase-2 placeholder. Phase 3 reads from Stripe via subscriptions table."""
    return {
        "user_id": user.id,
        "plan": "free",
        "active": True,
        "trial_ends_at": None,
        "current_period_end": None,
    }


@router.get("/license")
def license_get(user: User = Depends(current_user)) -> dict:
    return _free_tier_license(user)


@router.post("/license/refresh")
def license_refresh(user: User = Depends(current_user)) -> dict:
    return _free_tier_license(user)
