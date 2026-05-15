"""Stripe-backed subscription state, mirrored locally.

Stripe owns the billing source of truth; we mirror just enough to answer
`/v1/license` without a Stripe round-trip on every request. One row per
user (the `user_id` unique constraint) — created lazily by
`ensure_customer` on first checkout, and kept current by the
`/v1/billing/webhook` handler.

Absence of a row means Free. A row with `plan == "free"` (e.g. after a
cancellation) also means Free; the row is kept so a re-subscribe reuses
the same Stripe customer.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # Stripe ids. customer_id is the webhook lookup key — customer.subscription.*
    # events carry `customer`, not our user_id.
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # `status` mirrors Stripe's subscription status string (active, past_due,
    # canceled, incomplete, …) plus the sentinel "free". `plan` is derived:
    # "pro" while the subscription entitles access, else "free".
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="free")
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="free")
    price_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Both ends of the current Stripe billing period. `current_period_start`
    # was added in migration 0004 to scope Pro's per-period quota window;
    # `current_period_end` was already in 0003 for the renewal-date UI.
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow,
    )
