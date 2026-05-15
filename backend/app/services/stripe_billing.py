"""Stripe billing client (thin).

All `stripe` SDK calls live here so the routers stay transport-agnostic —
same reasoning that keeps Clerk behind `services/clerk*.py`. The module
covers the phase-3 "single Pro plan, track-state-only" scope:

  * `ensure_customer`  — lazily create the Stripe customer + local row
  * `create_checkout_session` / `create_portal_session` — hosted-page URLs
  * `parse_webhook_event` — signature-verified event decode
  * `upsert_subscription_from_stripe` — idempotent mirror of a Stripe
    Subscription into the `subscriptions` table

It deliberately does NOT touch rate limiting; `/v1/license` just reads the
row this module writes.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import stripe
from sqlalchemy.orm import Session

from ..logging import log
from ..models.subscription import Subscription
from ..models.user import User
from ..settings import get_settings

# Stripe statuses that still entitle Pro access. `canceled`, `incomplete`,
# `incomplete_expired`, `unpaid` do not.
_ACTIVE_STATUSES = {"active", "trialing", "past_due"}


class StripeBillingError(Exception):
    """Raised when Stripe is unreachable, misconfigured, or rejects a request."""


def _client() -> None:
    """Point the SDK at our key. Raises if billing isn't configured."""
    settings = get_settings()
    if not settings.stripe_configured:
        raise StripeBillingError("Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key


def resolve_price_to_plan(price_id: str | None) -> str:
    """Map a Stripe price id to our plan name. Anything we don't recognise
    (or no price at all) is treated as Free."""
    settings = get_settings()
    known = {settings.stripe_price_id_monthly, settings.stripe_price_id_annual}
    known.discard("")
    return "pro" if price_id and price_id in known else "free"


def _get_or_create_row(db: Session, user_id: int) -> Subscription:
    row = (
        db.query(Subscription)
        .filter(Subscription.user_id == user_id)
        .one_or_none()
    )
    if row is None:
        row = Subscription(user_id=user_id)
        db.add(row)
    return row


def ensure_customer(db: Session, user: User) -> str:
    """Return the user's Stripe customer id, creating the customer and the
    local `subscriptions` row on first use.

    Idempotent: a Stripe `idempotency_key` plus the unique constraint on
    `subscriptions.user_id` keep concurrent `/checkout` calls from minting
    duplicate customers.
    """
    _client()
    row = _get_or_create_row(db, user.id)
    if row.stripe_customer_id:
        return row.stripe_customer_id

    try:
        customer = stripe.Customer.create(
            email=user.email or None,
            metadata={
                "anyspace_user_id": str(user.id),
                "clerk_user_id": user.clerk_user_id,
            },
            idempotency_key=f"customer-create-{user.id}",
        )
    except stripe.StripeError as e:
        raise StripeBillingError(f"customer create failed: {e}") from e

    row.stripe_customer_id = customer["id"]
    db.commit()
    return row.stripe_customer_id


def create_checkout_session(
    customer_id: str, price_id: str, success_url: str, cancel_url: str,
) -> str:
    """Create a subscription-mode Checkout Session, return its hosted URL."""
    _client()
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=customer_id,
        )
    except stripe.StripeError as e:
        raise StripeBillingError(f"checkout session failed: {e}") from e
    url = getattr(session, "url", None)  # StripeObject — see _as_dict comment
    if not url:
        raise StripeBillingError("checkout session missing url")
    return url


def create_portal_session(customer_id: str, return_url: str) -> str:
    """Create a Billing Portal session, return its hosted URL."""
    _client()
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
    except stripe.StripeError as e:
        raise StripeBillingError(f"portal session failed: {e}") from e
    url = getattr(session, "url", None)
    if not url:
        raise StripeBillingError("portal session missing url")
    return url


def _as_dict(obj: Any) -> Any:
    """Normalize a `StripeObject` (what the SDK returns from real API/webhook
    payloads) to a plain dict, recursively, so downstream code can use `.get()`
    uniformly. `StripeObject` is NOT a `dict` subclass and intercepts attribute
    access via `__getattr__`, which turns `.get(...)` into a lookup for a key
    named "get" and raises AttributeError. JSON round-trip uses `StripeObject`'s
    public `__str__` (JSON-serialized form), which is recursive. Plain dicts
    (from tests/e2e) pass through unchanged.
    """
    if isinstance(obj, dict):
        return obj
    return json.loads(str(obj))


def parse_webhook_event(payload: bytes, sig_header: str) -> dict[str, Any]:
    """Verify the Stripe signature and return the decoded event as a plain dict."""
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        raise StripeBillingError("STRIPE_WEBHOOK_SECRET not configured")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret,
        )
    except (ValueError, stripe.SignatureVerificationError) as e:
        raise StripeBillingError(f"invalid webhook signature: {e}") from e
    return _as_dict(event)


def retrieve_subscription(subscription_id: str) -> dict[str, Any]:
    """Fetch a full Subscription object by id (returned as a plain dict)."""
    _client()
    try:
        return _as_dict(stripe.Subscription.retrieve(subscription_id))
    except stripe.StripeError as e:
        raise StripeBillingError(f"subscription retrieve failed: {e}") from e


def _first_item(sub: Any) -> dict[str, Any]:
    items = (sub.get("items") or {}).get("data") or []
    return items[0] if items else {}


def _price_id(sub: Any) -> str | None:
    """Stripe API versions ≥ 2025-03 keep the price on the subscription item."""
    item = _first_item(sub)
    price = item.get("price") or {}
    return price.get("id")


def _period_end(sub: Any) -> datetime | None:
    """`current_period_end` lives at the top level on older API versions and
    on the subscription item on newer ones — check both."""
    ts = sub.get("current_period_end") or _first_item(sub).get("current_period_end")
    return datetime.utcfromtimestamp(ts) if ts else None


def _period_start(sub: Any) -> datetime | None:
    """Same dual location as `_period_end`. Used by the quota service to scope
    Pro's fair-use window to the current billing period."""
    ts = sub.get("current_period_start") or _first_item(sub).get("current_period_start")
    return datetime.utcfromtimestamp(ts) if ts else None


def upsert_subscription_from_stripe(db: Session, sub: Any) -> bool:
    """Mirror a Stripe Subscription object into the `subscriptions` table.

    Fully idempotent — every field is derived from the payload, keyed on the
    local row by `stripe_customer_id` (fallback `stripe_subscription_id`).
    Returns False (and logs) when no local row matches, e.g. the webhook
    raced ahead of the `/checkout` commit; Stripe's retry reconciles.
    """
    sub = _as_dict(sub)  # tolerate StripeObject from direct callers
    customer_id = sub.get("customer")
    subscription_id = sub.get("id")
    row = (
        db.query(Subscription)
        .filter(Subscription.stripe_customer_id == customer_id)
        .one_or_none()
        if customer_id
        else None
    )
    if row is None and subscription_id:
        row = (
            db.query(Subscription)
            .filter(Subscription.stripe_subscription_id == subscription_id)
            .one_or_none()
        )
    if row is None:
        log.warning(
            "stripe.subscription.no_local_row",
            customer_id=customer_id, subscription_id=subscription_id,
        )
        return False

    status = sub.get("status") or "free"
    price_id = _price_id(sub)
    # A canceled/expired subscription drops the user back to Free; keep the
    # row (and stripe_customer_id) so a re-subscribe reuses the customer.
    plan = "pro" if status in _ACTIVE_STATUSES else "free"
    if plan == "pro":
        plan = resolve_price_to_plan(price_id)

    row.stripe_subscription_id = subscription_id
    if customer_id:
        row.stripe_customer_id = customer_id
    row.status = status
    row.plan = plan
    row.price_id = price_id
    row.current_period_start = _period_start(sub)
    row.current_period_end = _period_end(sub)
    row.cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    db.commit()
    return True
