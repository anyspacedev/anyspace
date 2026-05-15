"""subscriptions table (phase 3 — Stripe billing)

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-14
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "user_id", sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stripe_customer_id", sa.String(64), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="free"),
        sa.Column("plan", sa.String(32), nullable=False, server_default="free"),
        sa.Column("price_id", sa.String(64), nullable=True),
        sa.Column("current_period_end", sa.DateTime, nullable=True),
        sa.Column(
            "cancel_at_period_end", sa.Boolean, nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_at", sa.DateTime, nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False,
                  server_default=sa.func.now()),
    )
    # One subscription row per user; the webhook upserts on user_id.
    op.create_index(
        "ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True,
    )
    # customer.subscription.* webhook events look the row up by customer id.
    op.create_index(
        "ix_subscriptions_stripe_customer_id",
        "subscriptions", ["stripe_customer_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_subscriptions_stripe_customer_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_table("subscriptions")
