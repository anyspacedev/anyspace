"""Reusable FastAPI dependencies."""

from __future__ import annotations

import ipaddress
from datetime import datetime

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models.user import User
from .services.clerk import JWTValidationError, verify_clerk_jwt
from .settings import get_settings


def _is_trusted_proxy(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    for raw in get_settings().trusted_proxy_list:
        try:
            if "/" in raw:
                if ip in ipaddress.ip_network(raw, strict=False):
                    return True
            else:
                if ip == ipaddress.ip_address(raw):
                    return True
        except ValueError:
            continue
    return False


def client_ip(request: Request) -> str:
    """Return the client's source IP, honoring X-Forwarded-For only when the
    immediate peer is on the trusted proxy list (Tailscale Funnel CGNAT range,
    localhost). Without that gate, any caller could spoof the rate-limit key.
    """
    peer = request.client.host if request.client else "0.0.0.0"
    fwd = request.headers.get("x-forwarded-for")
    if fwd and _is_trusted_proxy(peer):
        # Take the leftmost (original) entry.
        return fwd.split(",")[0].strip()
    return peer


# Bearer scheme — auto_error=False so we can return our own 401 shape.
_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Verify a Clerk-issued Bearer JWT and return the local User row,
    creating it lazily on first authenticated request from this Clerk user.
    """
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = verify_clerk_jwt(creds.credentials)
    except JWTValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    clerk_user_id = claims["sub"]
    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).one_or_none()
    if user is None:
        # Lazy-create on first sight. Email may arrive later via webhook.
        user = User(
            clerk_user_id=clerk_user_id,
            email=claims.get("email"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.deleted_at is not None:
        # Webhook marked the Clerk user as deleted; refuse access.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="account deleted",
        )
    else:
        # Cheap sync: keep email fresh if the JWT carries one and we don't.
        new_email = claims.get("email")
        if new_email and user.email != new_email:
            user.email = new_email
            user.updated_at = datetime.utcnow()
            db.commit()
    return user
