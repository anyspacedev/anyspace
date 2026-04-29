"""audit_log: one row per /v1/audio/transcriptions request.

Phase 1: `user_id` is always NULL; we capture `ip` for ratelimit forensics.
Phase 2: same row shape, populated `user_id` from the verified JWT.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow,
    )
    ip: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str] = mapped_column(String(120), nullable=False)
    audio_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    infer_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
