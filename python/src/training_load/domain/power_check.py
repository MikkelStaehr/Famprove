"""Power data checks (decided with the user 2026-10-13). Pure: no I/O.

Spike warning per ride (activities.data_warning, shown as "Tjek effektdata" in the week view):
- Rule A, peak: the ride's max power (intervals.icu icu_pm_p_max, the best 1-s power, which
  equals the stream's maximum) > MAX_OVER_EPMAX x the athlete's ePmax on that day
  (icu_rolling_p_max).
- Rule B, single sample: one power sample more than SPIKE_ABOVE_NEIGHBOURS_W above both of its
  neighbours. It needs the power stream, which is fetched only for rides whose max power is
  above STREAM_IF_MAX_OVER_FTP x the ride's FTP (to keep API calls down).
The text says which rule fired, with the numbers, in Danish (it is the badge's tooltip).

FTP sanity (app_notices, kind ftp_mismatch, a line on /load): the FTP set in intervals.icu
against intervals.icu's own eFTP (its power model); a notice while they differ by more than
FTP_MISMATCH_SHARE of the FTP, none when they agree.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

MAX_OVER_EPMAX: Final = 1.3
SPIKE_ABOVE_NEIGHBOURS_W: Final = 300
STREAM_IF_MAX_OVER_FTP: Final = 2.0
FTP_MISMATCH_SHARE: Final = 0.15
FTP_NOTICE_KIND: Final = "ftp_mismatch"


@dataclass(frozen=True, slots=True)
class Spike:
    watts: int  # the sample
    above: int  # watts above the higher of its two neighbours
    at_s: int | None  # seconds into the ride (the stream's time), None when unknown


def needs_stream(max_w: int | None, ftp_w: int | None) -> bool:
    """Rule B is checked only on rides whose max power is above 2 x their FTP."""
    return (
        max_w is not None
        and ftp_w is not None
        and ftp_w > 0
        and max_w > STREAM_IF_MAX_OVER_FTP * ftp_w
    )


def largest_spike(
    watts: Sequence[int | None], times: Sequence[int | None] | None = None
) -> Spike | None:
    """The sample that stands highest above BOTH neighbours by more than the limit; None if none.
    A missing sample (None) or a missing neighbour never makes a spike."""
    best: Spike | None = None
    for i in range(1, len(watts) - 1):
        before, here, after = watts[i - 1], watts[i], watts[i + 1]
        if before is None or here is None or after is None:
            continue
        above = here - max(before, after)
        if above > SPIKE_ABOVE_NEIGHBOURS_W and (best is None or above > best.above):
            at = times[i] if times is not None and i < len(times) else None
            best = Spike(watts=here, above=above, at_s=at)
    return best


def _w(watts: float) -> str:
    """Whole watts in Danish: 1180 -> "1.180 W"."""
    return f"{round(watts):,} W".replace(",", ".")


def _clock(seconds: int) -> str:
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def data_warning(max_w: int | None, epmax_w: float | None, spike: Spike | None) -> str | None:
    """The badge's tooltip: which rule fired, with the numbers; None when neither did."""
    parts: list[str] = []
    if (
        max_w is not None
        and epmax_w is not None
        and epmax_w > 0
        and max_w > MAX_OVER_EPMAX * epmax_w
    ):
        factor = f"{MAX_OVER_EPMAX:g}".replace(".", ",")
        parts.append(f"Maks {_w(max_w)} er over {factor} × din ePmax ({_w(epmax_w)})")  # noqa: RUF001  # Danish UI text
    if spike is not None:
        when = "" if spike.at_s is None else f" efter {_clock(spike.at_s)}"
        parts.append(
            f"Ét sample på {_w(spike.watts)} ligger {_w(spike.above)} over begge naboer{when}"
        )
    return "; ".join(parts) + "." if parts else None


def ftp_notice(ftp_w: int | None, eftp_w: int | None) -> str | None:
    """The /load notice while the FTP and the eFTP differ by more than 15 % of the FTP."""
    if ftp_w is None or eftp_w is None or ftp_w <= 0 or eftp_w <= 0:
        return None
    if abs(ftp_w - eftp_w) <= FTP_MISMATCH_SHARE * ftp_w:
        return None
    return f"FTP er sat til {ftp_w} W, men dine ture peger på {eftp_w} W"
