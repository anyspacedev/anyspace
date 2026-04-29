"""init: api_keys (phase-2 placeholder), audit_log (active in phase 1)

Revision ID: 0001
Revises:
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("hash", sa.String(128), unique=True, nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime, nullable=True),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("ip", sa.String(64), nullable=False),
        sa.Column("path", sa.String(120), nullable=False),
        sa.Column("audio_sec", sa.Float, nullable=True),
        sa.Column("infer_sec", sa.Float, nullable=True),
        sa.Column("status", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=True),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_log_ip", "audit_log", ["ip"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_ip", table_name="audit_log")
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_table("api_keys")
