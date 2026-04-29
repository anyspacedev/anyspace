"""In-memory per-IP token-bucket rate limiter.

Phase 1 only — when phase 2 lands and we have a real `user_id`, this swaps
to per-user bucketing. When we go multi-process (uvicorn workers > 1) we
move the storage to Redis. Today we run a single uvicorn worker so an
in-memory dict is fine and stays consistent under concurrent requests
because it's accessed from a single asyncio event loop.

Two windows: per-minute (burst control) and per-hour (daily-ish ceiling).
A request must obtain a token from BOTH buckets to proceed. We don't try
to be clever about partial refunds; a successful request consumes 1 from
each bucket.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from ..settings import get_settings


@dataclass
class _Bucket:
    tokens: float
    last_refill: float
    capacity: int
    refill_rate_per_sec: float

    def take(self, now: float) -> bool:
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate_per_sec)
        self.last_refill = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    def retry_after(self) -> float:
        if self.refill_rate_per_sec <= 0:
            return 60.0
        deficit = 1 - self.tokens
        return max(0.5, deficit / self.refill_rate_per_sec)


class RateLimiter:
    def __init__(self, per_min: int, per_hour: int) -> None:
        self.per_min = per_min
        self.per_hour = per_hour
        self._buckets: dict[str, tuple[_Bucket, _Bucket]] = {}

    def _ensure(self, key: str) -> tuple[_Bucket, _Bucket]:
        bs = self._buckets.get(key)
        if bs is None:
            now = time.monotonic()
            bs = (
                _Bucket(self.per_min, now, self.per_min, self.per_min / 60.0),
                _Bucket(self.per_hour, now, self.per_hour, self.per_hour / 3600.0),
            )
            self._buckets[key] = bs
        return bs

    def check(self, key: str) -> tuple[bool, float]:
        """Returns (allowed, retry_after_seconds_if_denied)."""
        now = time.monotonic()
        b_min, b_hour = self._ensure(key)
        # Check both buckets BEFORE consuming so we don't half-spend.
        # Refill into temporary copies; only commit when we know both pass.
        # Simpler: take from per-hour first (slower refill = stricter cap),
        # then per-min. If the second fails, refund the first.
        if not b_hour.take(now):
            return False, b_hour.retry_after()
        if not b_min.take(now):
            b_hour.tokens += 1
            return False, b_min.retry_after()
        return True, 0.0


_limiter: RateLimiter | None = None


def get_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        s = get_settings()
        _limiter = RateLimiter(per_min=s.rate_limit_per_min, per_hour=s.rate_limit_per_hour)
    return _limiter
