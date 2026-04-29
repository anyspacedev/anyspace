"""Clerk JWT verification.

Clerk issues short-lived RS256 access tokens (default 60s TTL). The
public keys live at `<frontend_api>/.well-known/jwks.json` keyed by `kid`.
We cache the JWKS for an hour and refresh on cache miss / unknown kid.

We deliberately do NOT use the Clerk Python SDK — this is ~80 lines and
removes a heavy transitive-dep tree. PyJWT does the heavy lifting.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import httpx
import jwt
from jwt import PyJWKClient, PyJWKClientError

from ..settings import get_settings


class JWTValidationError(Exception):
    """Wraps any verification failure with a stable message for the API."""


@dataclass
class _JwksCache:
    client: PyJWKClient | None = None
    fetched_at: float = 0.0


_TTL_SEC = 3600
_lock = threading.Lock()
_cache = _JwksCache()


def _get_client(force_refresh: bool = False) -> PyJWKClient:
    """Return a PyJWKClient, refreshing the JWKS when stale or forced."""
    settings = get_settings()
    if not settings.clerk_frontend_api:
        raise JWTValidationError("CLERK_FRONTEND_API not configured")

    now = time.monotonic()
    with _lock:
        stale = (
            _cache.client is None
            or force_refresh
            or (now - _cache.fetched_at) > _TTL_SEC
        )
        if stale:
            try:
                # PyJWKClient lazily fetches on first lookup; force a fetch
                # here so a startup-time misconfig surfaces immediately.
                client = PyJWKClient(settings.clerk_jwks_url, lifespan=_TTL_SEC)
                client.get_signing_keys()
            except (PyJWKClientError, httpx.HTTPError) as e:
                raise JWTValidationError(f"jwks fetch failed: {e}") from e
            _cache.client = client
            _cache.fetched_at = now
        return _cache.client


def verify_clerk_jwt(token: str) -> dict:
    """Verify a Clerk-issued JWT and return its claims."""
    settings = get_settings()
    if not token:
        raise JWTValidationError("missing token")

    # Two-pass JWKS lookup: try cache, on unknown-kid refresh once.
    for force in (False, True):
        client = _get_client(force_refresh=force)
        try:
            signing_key = client.get_signing_key_from_jwt(token).key
        except PyJWKClientError:
            # Unknown kid — JWKS may be stale; refresh and retry once.
            if force:
                raise JWTValidationError("kid not found in jwks")
            continue
        except jwt.PyJWTError as e:
            # Malformed token (no segments, bad b64, etc.) — never recoverable.
            raise JWTValidationError(f"malformed token: {e}") from e

        try:
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                # Clerk does not issue an `aud` claim by default. Disable
                # audience validation; rely on issuer + signature instead.
                options={"verify_aud": False},
                issuer=settings.clerk_issuer,
                leeway=settings.clerk_jwt_leeway_sec,
            )
        except jwt.ExpiredSignatureError as e:
            raise JWTValidationError("token expired") from e
        except jwt.InvalidIssuerError as e:
            raise JWTValidationError("issuer mismatch") from e
        except jwt.InvalidTokenError as e:
            raise JWTValidationError(f"invalid token: {e}") from e

        if not claims.get("sub"):
            raise JWTValidationError("token has no sub claim")
        return claims

    raise JWTValidationError("verification fell through")  # unreachable


def reset_cache_for_tests() -> None:
    """Used by tests that swap the JWKS endpoint between cases."""
    with _lock:
        _cache.client = None
        _cache.fetched_at = 0.0
