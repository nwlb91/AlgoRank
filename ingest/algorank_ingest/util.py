"""Shared helpers: rate limiting, backoff, deadlines, timestamp parsing."""

from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timezone, timedelta

log = logging.getLogger("algorank")


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # One log line per API request is far too chatty over a multi-day backfill.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


class RateLimiter:
    """Simple sliding-window limiter: at most `limit` acquisitions per `period` seconds."""

    def __init__(self, limit: int, period: float = 60.0):
        self.limit = max(1, limit)
        self.period = period
        self._stamps: list[float] = []

    def acquire(self) -> None:
        now = time.monotonic()
        cutoff = now - self.period
        self._stamps = [t for t in self._stamps if t > cutoff]
        if len(self._stamps) >= self.limit:
            wait = self._stamps[0] + self.period - now
            if wait > 0:
                time.sleep(wait)
        self._stamps.append(time.monotonic())


def backoff_sleep(attempt: int, base: float = 2.0, cap: float = 120.0) -> None:
    delay = min(cap, base * (2 ** attempt)) * (0.5 + random.random())
    time.sleep(delay)


class Deadline:
    """Cooperative deadline for chunked runs (e.g. CI jobs with max runtime)."""

    def __init__(self, minutes: int = 0):
        self._until = time.monotonic() + minutes * 60 if minutes > 0 else None

    def exceeded(self) -> bool:
        return self._until is not None and time.monotonic() > self._until


def ts_to_dt(value) -> datetime | None:
    """Unix seconds (start.gg) -> aware datetime."""
    if value in (None, "", 0):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (ValueError, TypeError, OSError):
        return None


def iso_to_dt(value) -> datetime | None:
    """RFC3339 string (parry.gg JSON timestamps) -> aware datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_date(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def month_windows(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Contiguous ~30-day windows covering [start, end)."""
    out = []
    cur = start
    step = timedelta(days=30)
    while cur < end:
        nxt = min(cur + step, end)
        out.append((cur, nxt))
        cur = nxt
    return out
