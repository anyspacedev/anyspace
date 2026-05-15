"""Cloud usage quota enforcement.

`check_or_raise(db, user, kind)` is called at the top of `/v1/audio/transcriptions`
and `/v1/chat/completions` (after `current_user`, before the upstream call). It
sums usage from the existing `audit_log` table within the user's current quota
window and raises `HTTPException(402, ...)` with a structured body if they're
at the cap.

Window choice:
  - **Free** (no subscription, or subscription rolled back to `plan="free"`):
    calendar month UTC.
  - **Pro** (`plan="pro"` row exists): `current_period_start`..`current_period_end`
    on the local `subscriptions` mirror — populated by the Stripe webhook.

The check is `used >= limit` against current totals (no per-request increment
arithmetic). This admits at most ONE over-quota request per period in the worst
case — explicitly accepted in the plan as the simplicity trade-off vs accurate
pre-decode estimation.

Cap source: `audit_log` rows with `status < 500` (don't bill failed requests).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.audit_log import AuditLog
from ..models.subscription import Subscription
from ..models.user import User
from ..settings import get_settings

# Stripe statuses that still entitle Pro access (mirrors stripe_billing).
_ACTIVE_STATUSES = {"active", "trialing", "past_due"}

Kind = Literal["ai", "stt"]

# Path that each kind logs under in audit_log.
_PATH_FOR_KIND: dict[Kind, str] = {
    "ai":  "/v1/chat/completions",
    "stt": "/v1/audio/transcriptions",
}


@dataclass(frozen=True)
class _Window:
    plan: str                 # "free" | "pro"
    start: datetime
    end: datetime
    ai_limit: int
    stt_limit: int            # seconds
    quota_kind_label: str     # "free" or "pro_abuse" (used in the 402 body)


def _start_of_next_month(d: datetime) -> datetime:
    """First day of the month following `d` (UTC), midnight."""
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime(year, month, 1)


def _window_for(db: Session, user: User) -> _Window:
    """Resolve the user's current quota window + caps.

    Pro users with a populated billing period → that period.
    Everyone else → calendar month UTC at the Free cap.
    """
    settings = get_settings()
    sub = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id)
        .one_or_none()
    )
    if (sub is not None
            and sub.plan == "pro"
            and sub.status in _ACTIVE_STATUSES
            and sub.current_period_start is not None
            and sub.current_period_end is not None):
        return _Window(
            plan="pro",
            start=sub.current_period_start,
            end=sub.current_period_end,
            ai_limit=settings.pro_quota_ai_per_period,
            stt_limit=settings.pro_quota_stt_secs_per_period,
            quota_kind_label="pro_abuse",
        )

    now = datetime.utcnow()
    start = datetime(now.year, now.month, 1)
    return _Window(
        plan="free",
        start=start,
        end=_start_of_next_month(start),
        ai_limit=settings.free_quota_ai_per_month,
        stt_limit=settings.free_quota_stt_secs_per_month,
        quota_kind_label="free",
    )


def _used_ai(db: Session, user_id: int, w: _Window) -> int:
    count = (
        db.query(func.count(AuditLog.id))
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.path == _PATH_FOR_KIND["ai"],
            AuditLog.status < 500,
            AuditLog.created_at >= w.start,
            AuditLog.created_at < w.end,
        )
        .scalar()
    )
    return int(count or 0)


def _used_stt_seconds(db: Session, user_id: int, w: _Window) -> float:
    total = (
        db.query(func.coalesce(func.sum(AuditLog.audio_sec), 0.0))
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.path == _PATH_FOR_KIND["stt"],
            AuditLog.status < 500,
            AuditLog.created_at >= w.start,
            AuditLog.created_at < w.end,
        )
        .scalar()
    )
    return float(total or 0.0)


def _raise_402(plan: str, kind: Kind, kind_label: str,
               used: float, limit: float, resets_at: datetime) -> None:
    if kind_label == "pro_abuse":
        detail = (
            f"AnySpace Pro fair-use ceiling reached for {kind.upper()}. "
            f"This is unusually high usage — please reach out at hi@anyspace.dev."
        )
    else:
        unit = "calls" if kind == "ai" else "seconds"
        detail = (
            f"Free monthly {kind.upper()} quota exceeded "
            f"({int(used)}/{int(limit)} {unit}). Upgrade to Pro or use your own API key."
        )
    raise HTTPException(
        status_code=402,
        detail={
            "detail": detail,
            "plan": plan,
            "quota_kind": kind_label if kind_label == "pro_abuse" else kind,
            "used": used if kind == "stt" else int(used),
            "limit": int(limit),
            "resets_at": resets_at.replace(microsecond=0).isoformat() + "Z",
            "upgrade_url": "/v1/billing/checkout",
        },
    )


def check_or_raise(db: Session, user: User, kind: Kind) -> None:
    """Raise HTTPException(402, ...) if `user` is at or past the cap for `kind`
    in the current quota window. Otherwise return silently — the route handler
    proceeds; an `audit_log` row gets written at the end of the request and
    counts towards the next call's check.
    """
    w = _window_for(db, user)
    if kind == "ai":
        used = _used_ai(db, user.id, w)
        if used >= w.ai_limit:
            _raise_402(w.plan, "ai", w.quota_kind_label, used, w.ai_limit, w.end)
    elif kind == "stt":
        used = _used_stt_seconds(db, user.id, w)
        if used >= w.stt_limit:
            _raise_402(w.plan, "stt", w.quota_kind_label, used, w.stt_limit, w.end)
    else:
        raise ValueError(f"unknown quota kind: {kind}")


def usage_snapshot(db: Session, user: User) -> dict:
    """Read-only summary of the user's current quota window for `/v1/usage`."""
    w = _window_for(db, user)
    return {
        "plan": w.plan,
        "window_start": w.start.replace(microsecond=0).isoformat() + "Z",
        "window_end":   w.end.replace(microsecond=0).isoformat() + "Z",
        "ai":  {
            "used":  _used_ai(db, user.id, w),
            "limit": w.ai_limit,
            "kind":  "ai",
        },
        "stt": {
            "used_sec":  _used_stt_seconds(db, user.id, w),
            "limit_sec": w.stt_limit,
            "kind":      "stt",
        },
    }
