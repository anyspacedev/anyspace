"""Desktop OAuth bridge.

Bridge between the marketing site's `/desktop/sign-in` page (where the
user completes Clerk OAuth in a real browser) and the desktop app's
loopback listener. The browser bridge calls this endpoint with the
user's freshly-minted Clerk session JWT; we mint a single-use sign-in
ticket scoped to that user and return it. The bridge then redirects to
`http://127.0.0.1:<port>/callback?ticket=…` where the desktop app
redeems the ticket via `signIn.create({ strategy: "ticket" })`.

Why this exists: WebKit ITP refuses to persist Clerk's Set-Cookie on
the cross-site XHR that seeds OAuth state, so the desktop WebView's
in-modal Google sign-in dies at the callback. Routing OAuth through
the user's real browser sidesteps ITP entirely; the ticket carries the
session into the WebView.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import current_user
from ..models.user import User
from ..services.clerk_backend import ClerkBackendError, mint_sign_in_token

router = APIRouter(prefix="/v1/desktop-bridge")


@router.post("/mint-ticket")
def mint_ticket(user: User = Depends(current_user)) -> dict:
    """Mint a 60-second sign-in ticket for the authenticated caller.

    The caller authenticates with their normal Clerk session JWT (the one
    `useAuth().getToken()` returns after sign-in in the browser). We use
    that JWT only for authn; the ticket we mint is scoped to the same
    user via Clerk's Backend API.
    """
    try:
        ticket = mint_sign_in_token(user.clerk_user_id)
    except ClerkBackendError as e:
        # Clerk-side failure (bad secret key, user not found, 5xx). We
        # surface as 502 — the request shape was fine, the upstream
        # couldn't fulfill it.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"could not mint sign-in ticket: {e}",
        ) from e
    return {"ticket": ticket}
