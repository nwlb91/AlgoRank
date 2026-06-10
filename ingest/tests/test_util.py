import time
from datetime import datetime, timezone

from algorank_ingest.util import Deadline, RateLimiter, month_windows, parse_date, ts_to_dt, iso_to_dt


def test_month_windows_cover_range():
    start = parse_date("2015-01-01")
    end = parse_date("2015-07-15")
    wins = month_windows(start, end)
    assert wins[0][0] == start
    assert wins[-1][1] == end
    for (a, b), (c, d) in zip(wins, wins[1:]):
        assert b == c  # contiguous
    assert all(a < b for a, b in wins)


def test_timestamp_parsing():
    dt = ts_to_dt(1475850000)
    assert dt.tzinfo is not None and dt.year == 2016
    assert ts_to_dt(None) is None
    assert ts_to_dt(0) is None
    assert iso_to_dt("2025-06-08T21:14:09Z") == datetime(2025, 6, 8, 21, 14, 9, tzinfo=timezone.utc)
    assert iso_to_dt("") is None


def test_rate_limiter_blocks():
    rl = RateLimiter(limit=2, period=0.2)
    t0 = time.monotonic()
    rl.acquire()
    rl.acquire()
    rl.acquire()  # third acquisition must wait ~0.2s
    elapsed = time.monotonic() - t0
    assert elapsed >= 0.15


def test_deadline():
    assert not Deadline(0).exceeded()  # unlimited
    d = Deadline(1)
    assert not d.exceeded()
