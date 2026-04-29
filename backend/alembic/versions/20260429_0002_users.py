"""users table + audit_log.user_id FK

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("clerk_user_id", sa.String(64), unique=True, nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False,
                  server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_users_clerk_user_id", "users", ["clerk_user_id"], unique=True)

    # audit_log.user_id existed in 0001 as a plain int. Promote to FK.
    # SQLite needs render_as_batch (configured in env.py) for this ALTER.
    with op.batch_alter_table("audit_log") as batch:
        batch.create_foreign_key(
            "fk_audit_log_user_id_users", "users",
            ["user_id"], ["id"], ondelete="SET NULL",
        )
    op.create_index("ix_audit_log_user_id", "audit_log", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_user_id", table_name="audit_log")
    with op.batch_alter_table("audit_log") as batch:
        batch.drop_constraint("fk_audit_log_user_id_users", type_="foreignkey")
    op.drop_index("ix_users_clerk_user_id", table_name="users")
    op.drop_table("users")
