"""FTP credibility and the user's confirmation (user, 2026-10-15, slice ftp-confirm). Pure: no I/O.

The ftp_mismatch notice (power_check.ftp_notice: |FTP - eFTP| > 15 % of the FTP) shows only while
intervals.icu's eFTP is credible: an effort of at least CREDIBLE_EFFORT_S at >= CREDIBLE_SHARE of
the FTP set, within the last 42 days. On the 42-day power curve that is the best power of any point
from 8 min on (sources.intervals: a mean-max curve can rise a little with duration, so not only the
8-min point). Not credible: /load shows a quiet line with the latest such effort in the last
TESTED_WEEKS weeks ("ikke testet siden").

Known blind spot (tech-lead, the user chose 90 % knowing it, 2026-10-15): the threshold is measured
against the FTP being questioned. A maximal 8-min effort is about 1.11 x the true FTP, so an FTP set
19 % or more too high never becomes credible; the quiet line is what the user sees then.

"230 W er rigtigt" (ftp_ack choice confirmed) suppresses the notice for CONFIRM_DAYS from the ack's
local date while the FTP is still the one confirmed, unless a credible effort dated after that day
comes with an eFTP more than CONFIRM_EFTP_SHARE from the eFTP at the tap. "Jeg har rettet FTP"
(fixed) suppresses nothing here: the web hides the notice until the next run writes it again.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final, Literal

from training_load.domain.dates import LOCAL_TZ
from training_load.domain.power_check import ftp_notice

CREDIBLE_SHARE: Final = 0.90  # user, 2026-10-15: "høj intensitet" = >= 90 % of the FTP set
CREDIBLE_EFFORT_S: Final = 480  # at least 8 min
TESTED_WEEKS: Final = 52  # how far back "ikke testet siden" looks
CONFIRM_DAYS: Final = 60
CONFIRM_EFTP_SHARE: Final = 0.05

type AckChoice = Literal["confirmed", "fixed"]


@dataclass(frozen=True, slots=True)
class Effort:
    """The best power of any effort of CREDIBLE_EFFORT_S or longer in a window, and its ride."""

    watts: int
    on: date | None  # local date of that ride; None when intervals.icu didn't name it (counted)


@dataclass(frozen=True, slots=True)
class FtpAck:
    """The newest public.ftp_ack row: the user's answer to the notice."""

    choice: AckChoice
    ftp_w: int  # the FTP the notice showed at the tap
    eftp_w: int | None  # the eFTP at the tap; None = unknown then
    at: datetime  # server time of the tap (tz-aware)


@dataclass(frozen=True, slots=True)
class FtpStatus:
    """public.ftp_status. Every None means unknown or none, never 0."""

    ftp_w: int | None  # the FTP set in intervals.icu
    eftp_w: int | None  # intervals.icu's eFTP (sportSettings.mmp_model.ftp)
    best_8min_42d_w: int | None  # None = no effort of 8 min or more with power in 42 days
    threshold_w: int | None  # CREDIBLE_SHARE x FTP, rounded up; None without an FTP
    credible: bool | None  # None without an FTP
    last_tested_on: date | None  # latest effort >= threshold in TESTED_WEEKS weeks; None = none
    ftp_since: date | None  # first ride of the latest run of rides with this FTP; None = unknown
    suppressed_until: date | None  # first day the notice may show again; None = not suppressed


def threshold_w(ftp_w: int | None) -> int | None:
    """CREDIBLE_SHARE x FTP rounded up (230 -> 207); round() guards float noise in 0.9 x FTP."""
    if ftp_w is None or ftp_w <= 0:
        return None
    return math.ceil(round(CREDIBLE_SHARE * ftp_w, 6))


def is_credible(best_42d: Effort | None, ftp_w: int | None) -> bool | None:
    threshold = threshold_w(ftp_w)
    if threshold is None:
        return None
    return best_42d is not None and best_42d.watts >= threshold


def last_tested_on(efforts: Sequence[Effort], ftp_w: int | None) -> date | None:
    """The latest dated effort at or above the threshold (efforts: the weekly bests)."""
    threshold = threshold_w(ftp_w)
    if threshold is None:
        return None
    return max((e.on for e in efforts if e.on is not None and e.watts >= threshold), default=None)


def ftp_since(rides: Sequence[tuple[date, int | None]], ftp_w: int | None) -> date | None:
    """The first ride of the latest unbroken run of rides with this FTP (each ride's icu_ftp is
    the FTP in force on it). intervals.icu keeps no FTP history, so this is "sat senest": the FTP
    may have been set any time after the ride before. None when the latest ride had another FTP
    (it was changed since) or there are no rides."""
    if ftp_w is None:
        return None
    since: date | None = None
    for day, ride_ftp in sorted(rides, key=lambda r: r[0], reverse=True):
        if ride_ftp != ftp_w:
            break
        since = day
    return since


def suppressed_until(
    ack: FtpAck | None,
    *,
    ftp_w: int | None,
    eftp_w: int | None,
    efforts: Sequence[Effort],
    today: date,
) -> date | None:
    """The day the notice may show again after "230 W er rigtigt"; None when nothing suppresses."""
    if ack is None or ack.choice != "confirmed" or ftp_w is None or ack.ftp_w != ftp_w:
        return None  # "fixed", or the FTP was changed since: the confirmation no longer holds
    acked_on = ack.at.astimezone(LOCAL_TZ).date()
    until = acked_on + timedelta(days=CONFIRM_DAYS)
    if today >= until:
        return None
    threshold = threshold_w(ftp_w)
    hard_since = threshold is not None and any(
        e.on is not None and e.on > acked_on and e.watts >= threshold for e in efforts
    )
    moved = (
        eftp_w is not None
        and ack.eftp_w is not None
        and abs(eftp_w - ack.eftp_w) > CONFIRM_EFTP_SHARE * ack.eftp_w
    )
    return None if hard_since and moved else until


def ftp_status(
    *,
    ftp_w: int | None,
    eftp_w: int | None,
    best_42d: Effort | None,
    weekly: Sequence[Effort],
    rides: Sequence[tuple[date, int | None]],
    ack: FtpAck | None,
    today: date,
    best_after: Effort | None = None,
) -> FtpStatus:
    """``best_after``: the best effort since the day after the answer (its own range, so a hard
    effort later in the answer's week counts even when that week's best came before it)."""
    efforts = [*weekly, *(e for e in (best_42d, best_after) if e is not None)]
    return FtpStatus(
        ftp_w=ftp_w,
        eftp_w=eftp_w,
        best_8min_42d_w=None if best_42d is None else best_42d.watts,
        threshold_w=threshold_w(ftp_w),
        credible=is_credible(best_42d, ftp_w),
        last_tested_on=last_tested_on(efforts, ftp_w),
        ftp_since=ftp_since(rides, ftp_w),
        suppressed_until=suppressed_until(
            ack, ftp_w=ftp_w, eftp_w=eftp_w, efforts=efforts, today=today
        ),
    )


def notice_message(status: FtpStatus) -> str | None:
    """The ftp_mismatch notice: only while credible and not suppressed."""
    if status.credible is not True or status.suppressed_until is not None:
        return None
    return ftp_notice(status.ftp_w, status.eftp_w)
