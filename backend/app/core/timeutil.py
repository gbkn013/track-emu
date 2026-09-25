"""Timezone utilities.

AGENTS.md §2: everything is Asia/Kolkata (IST, UTC+05:30, no DST). Store UTC in
the DB, convert at the edges. Never use naive datetimes.

We define a fixed UTC+05:30 offset (IST has no DST) rather than a full IANA
zone, so comparisons and arithmetic stay simple and deterministic. All datetimes
in the domain are timezone-aware.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone

#: Indian Standard Time — fixed UTC+05:30, no DST.
IST = timezone(timedelta(hours=5, minutes=30), name="Asia/Kolkata")

MINUTE = timedelta(minutes=1)
DAY = timedelta(days=1)


def utcnow() -> datetime:
    """The current instant, timezone-aware, expressed in IST. Use this as the
    'now' source at the edges; the ETA engine itself takes ``now`` as a
    parameter so it stays pure."""
    return datetime.now(UTC).astimezone(IST)


def in_ist(dt: datetime) -> datetime:
    """Return ``dt`` expressed in IST. Naive input is (defensively) assumed to
    already be IST and merely tagged — callers should prefer aware datetimes."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)


def combine_ist(d: date, t: time) -> datetime:
    """Combine a date and a time-of-day into an IST datetime — for building
    scheduled stop times from a timetable's offsets-from-origin."""
    return datetime.combine(d, t, tzinfo=IST)


def age_seconds(dt: datetime, now: datetime) -> int:
    """Whole seconds between ``dt`` and ``now`` (0 if ``dt`` is in the future)."""
    delta = now - in_ist(dt)
    return max(0, int(delta.total_seconds()))
