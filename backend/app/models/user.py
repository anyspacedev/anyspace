"""Local mirror of Clerk-managed users.

Clerk owns identity (email, password, OAuth links). We mirror the minimum
needed to attach billing + usage rows by FK: a stable internal `id`, the
Clerk-side `clerk_user_id`, and a denormalized `email` for support queries.

Rows are upserted from two sides:
  * lazy-create on first authenticated request (in `deps.current_user`)
  * webhooks: user.created, user.updated, user.deleted
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clerk_user_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
