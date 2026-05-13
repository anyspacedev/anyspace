"""Clerk Backend API client (thin).

Counterpart to `services/clerk.py` (JWT verification). This module makes
authenticated calls to Clerk's server-side REST API using the project's
`CLERK_SECRET_KEY`. We keep this tiny — one function for now — and avoid
pulling in `clerk-backend-api`, matching the same reasoning that kept
JWT verification on plain PyJWT.
"""

from __future__ import annotations

import httpx

from ..settings import get_settings

_API_BASE = "https://api.clerk.com/v1"
_TIMEOUT_SEC = 10.0
_DEFAULT_TICKET_TTL_SEC = 60


class ClerkBackendError(Exception):
    """Raised when the Clerk Backend API returns a non-2xx or is unreachable."""


def mint_sign_in_token(
    clerk_user_id: str,
    expires_in_seconds: int = _DEFAULT_TICKET_TTL_SEC,
) -> str:
    """Mint a short-lived single-use sign-in ticket for an existing Clerk user.

    The returned string is what the desktop app's WebView feeds to
    `signIn.create({ strategy: "ticket", ticket })` — Clerk redeems it
    on the Frontend API and returns a fresh client session, sidestepping
    the OAuth-cookie path that WKWebView's ITP blocks.
    """
    settings = get_settings()
    if not settings.clerk_secret_key:
        raise ClerkBackendError("CLERK_SECRET_KEY not configured")
    try:
        resp = httpx.post(
            f"{_API_BASE}/sign_in_tokens",
            headers={
                "Authorization": f"Bearer {settings.clerk_secret_key}",
                "Content-Type": "application/json",
            },
            json={
                "user_id": clerk_user_id,
                "expires_in_seconds": expires_in_seconds,
            },
            timeout=_TIMEOUT_SEC,
        )
    except httpx.HTTPError as e:
        raise ClerkBackendError(f"network error: {e}") from e

    if resp.status_code // 100 != 2:
        raise ClerkBackendError(
            f"clerk responded {resp.status_code}: {resp.text[:200]}"
        )
    try:
        token = resp.json().get("token")
    except ValueError as e:
        raise ClerkBackendError(f"non-JSON response: {e}") from e
    if not isinstance(token, str) or not token:
        raise ClerkBackendError("clerk response missing 'token' field")
    return token
