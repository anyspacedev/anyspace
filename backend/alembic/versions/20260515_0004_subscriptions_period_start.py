"""subscriptions.current_period_start (Pro quota window)

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-15

Migration 0003 only stored `current_period_end` (sufficient for the
'renews on …' UI label). Pro's per-period fair-use quota also needs the
start of the window, so we add it as a nullable column — backfilled
naturally by the next webhook delivery (Stripe carries both timestamps).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("subscriptions") as batch:
        batch.add_column(sa.Column("current_period_start", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("subscriptions") as batch:
        batch.drop_column("current_period_start")
