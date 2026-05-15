"""Stripe billing — checkout, customer portal, webhook (phase 3).

The desktop app drives subscriptions through three endpoints:

  * POST /v1/billing/checkout — authenticated; returns a hosted Stripe
    Checkout URL the app opens in the user's real browser.
  * POST /v1/billing/portal — authenticated; returns a hosted Billing
    Portal URL for managing/cancelling an existing subscription.
  * POST /v1/billing/webhook — called by Stripe (signature-verified, no
    user auth); mirrors subscription state into the `subscriptions` table.

"Track state only": these endpoints persist subscription state that
`/v1/license` reads. Rate-limit gating stays out of scope for this phase.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..deps import current_user
from ..logging import log
from ..models.subscription import Subscription
from ..models.user import User
from ..services import stripe_billing
from ..services.stripe_billing import StripeBillingError
from ..settings import get_settings

router = APIRouter(prefix="/v1/billing")


class CheckoutRequest(BaseModel):
    interval: str = "monthly"  # "monthly" | "annual"


@router.post("/checkout")
def checkout(
    body: CheckoutRequest | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a Checkout Session for the Pro plan and return its URL."""
    settings = get_settings()
    if not settings.stripe_configured:
        raise HTTPException(503, "billing is not configured")

    interval = (body.interval if body else "monthly").lower()
    if interval == "annual":
        price_id = settings.stripe_price_id_annual
        if not price_id:
            raise HTTPException(400, "annual plan is not available")
    elif interval == "monthly":
        price_id = settings.stripe_price_id_monthly
    else:
        raise HTTPException(400, f"unknown interval: {interval}")

    try:
        customer_id = stripe_billing.ensure_customer(db, user)
        url = stripe_billing.create_checkout_session(
            customer_id,
            price_id,
            settings.stripe_checkout_success_url,
            settings.stripe_checkout_cancel_url,
        )
    except StripeBillingError as e:
        # Request shape was fine; Stripe couldn't fulfill it.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"could not start checkout: {e}",
        ) from e
    return {"url": url}


@router.post("/portal")
def portal(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Create a Billing Portal session for an existing customer."""
    settings = get_settings()
    if not settings.stripe_configured:
        raise HTTPException(503, "billing is not configured")

    sub = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id)
        .one_or_none()
    )
    if sub is None or not sub.stripe_customer_id:
        raise HTTPException(409, "no billing account — start a checkout first")

    try:
        url = stripe_billing.create_portal_session(
            sub.stripe_customer_id, settings.stripe_portal_return_url,
        )
    except StripeBillingError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"could not open billing portal: {e}",
        ) from e
    return {"url": url}


@router.post("/webhook")
async def webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="stripe-signature"),
) -> dict:
    """Stripe-driven subscription sync. Signature-verified; no user auth.

    Any validly-signed event returns 200 so Stripe doesn't retry — only a
    bad signature (401) or unconfigured secret (503) is non-2xx.
    """
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        # Refuse webhooks until the secret is set — otherwise any caller
        # could spoof subscription state.
        raise HTTPException(503, "webhook secret not configured")

    body = await request.body()
    try:
        event = stripe_billing.parse_webhook_event(body, stripe_signature)
    except StripeBillingError as e:
        raise HTTPException(401, f"invalid signature: {e}") from e

    event_type = event["type"]
    obj = event["data"]["object"]

    db = SessionLocal()
    try:
        if event_type == "checkout.session.completed":
            # The session carries customer + subscription ids; fetch the
            # full subscription so a single event is self-sufficient
            # regardless of event ordering.
            subscription_id = obj.get("subscription")
            if subscription_id:
                sub = stripe_billing.retrieve_subscription(subscription_id)
                stripe_billing.upsert_subscription_from_stripe(db, sub)
        elif event_type in (
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        ):
            stripe_billing.upsert_subscription_from_stripe(db, obj)
        else:
            log.info("stripe.webhook.unhandled", event_type=event_type)
            return {"ok": True}
    except StripeBillingError as e:
        # Stripe-side failure handling the event (e.g. retrieve failed).
        # Return 5xx so Stripe retries rather than dropping the event.
        log.warning("stripe.webhook.error", event_type=event_type, error=str(e))
        raise HTTPException(502, f"webhook handling failed: {e}") from e
    finally:
        db.close()

    log.info("stripe.webhook.applied", event_type=event_type)
    return {"ok": True}
