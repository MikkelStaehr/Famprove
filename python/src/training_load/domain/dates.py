"""Calendar constants: the series start and the local day boundary (Europe/Copenhagen)."""

from datetime import UTC, date, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

LOCAL_TZ: Final = ZoneInfo("Europe/Copenhagen")
SERIES_START: Final = date(2026, 1, 1)
"""First day of daily_load; CTL = ATL = 0 going into this day."""


def today_local(now: datetime | None = None) -> date:
    """Today's date in LOCAL_TZ. ``now`` (tz-aware) is injectable for tests."""
    return (now or datetime.now(UTC)).astimezone(LOCAL_TZ).date()


def date_range(start: date, end: date) -> list[date]:
    """Every date from ``start`` to ``end``, both inclusive. Empty when end < start."""
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]
