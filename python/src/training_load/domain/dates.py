"""Calendar constants: the series start and the local day boundary (Europe/Copenhagen)."""

from datetime import UTC, date, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

LOCAL_TZ: Final = ZoneInfo("Europe/Copenhagen")
SERIES_START: Final = date(2026, 1, 1)
"""First day of daily_load; CTL = ATL = 0 going into this day."""
ANALYSIS_START: Final = date(2024, 12, 30)
"""First day of the ride analysis (ride_metrics, cycling_weeks): the Monday of 2025-01-01's ISO
week, so the first week is whole. More trend points than SERIES_START. collect-intervals is
backfilled from here; daily_load ignores the earlier rides."""


def today_local(now: datetime | None = None) -> date:
    """Today's date in LOCAL_TZ. ``now`` (tz-aware) is injectable for tests."""
    return (now or datetime.now(UTC)).astimezone(LOCAL_TZ).date()


def date_range(start: date, end: date) -> list[date]:
    """Every date from ``start`` to ``end``, both inclusive. Empty when end < start."""
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]
