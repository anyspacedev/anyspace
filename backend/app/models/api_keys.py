"""Phase-2 placeholder: api_keys table.

Phase 1 does not enforce auth, but the table ships now so phase 2 doesn't
have to coordinate a desktop-app rollout with a backend migration.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
