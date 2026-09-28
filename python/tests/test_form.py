"""domain.form: CTL ramp and the intervals.icu form zones."""

import pytest

from training_load.domain.daily import build_daily_load
from training_load.domain.dates import SERIES_START
from training_load.domain.form import (
    FORM_BASIS,
    FORM_ZONES,
    FormBasis,
    FormZone,
    ctl_ramp,
    form_value,
    form_zone,
)


def test_band_table_invariants() -> None:
    lowers = [b.lower for b in FORM_ZONES]
    assert lowers[-1] is None and None not in lowers[:-1]
    floors = [lo for lo in lowers if lo is not None]
    assert floors == sorted(floors, reverse=True) and len(set(floors)) == len(floors)
    assert sorted(b.zone for b in FORM_ZONES) == sorted(FormZone)


def test_basis_matches_users_intervals_setting() -> None:
    # icu_form_as_percent = false on the user's intervals.icu athlete.
    assert FORM_BASIS is FormBasis.ABSOLUTE_TSB


@pytest.mark.parametrize(
    ("tsb", "zone"),
    [
        (35.0, FormZone.TRANSITION),
        (20.0, FormZone.TRANSITION),  # 20 belongs to the higher zone
        (19.9, FormZone.FRESH),
        (5.0, FormZone.FRESH),  # 5 belongs to the higher zone
        (4.9, FormZone.GREY_ZONE),
        (0.0, FormZone.GREY_ZONE),
        (-9.9, FormZone.GREY_ZONE),
        (-10.0, FormZone.OPTIMAL),  # -10 belongs to the lower zone
        (-29.9, FormZone.OPTIMAL),
        (-30.0, FormZone.HIGH_RISK),  # -30 belongs to the lower zone
        (-55.0, FormZone.HIGH_RISK),
    ],
)
def test_zone_boundaries_match_intervals(tsb: float, zone: FormZone) -> None:
    assert form_zone(tsb, ctl=50.0) is zone


def test_percent_basis_scales_by_ctl_and_is_zero_without_fitness() -> None:
    assert form_value(-6.0, 20.0, FormBasis.PERCENT_OF_CTL) == -30.0
    assert form_zone(-6.0, 20.0, FormBasis.PERCENT_OF_CTL) is FormZone.HIGH_RISK
    assert form_zone(-6.0, 20.0, FormBasis.ABSOLUTE_TSB) is FormZone.GREY_ZONE
    assert form_value(-3.0, 0.0, FormBasis.PERCENT_OF_CTL) == 0.0


def test_ctl_ramp_is_difference_to_seven_days_earlier() -> None:
    ctl = [float(i * i) for i in range(10)]
    ramp = ctl_ramp(ctl)
    assert ramp[:7] == [None] * 7
    assert ramp[7:] == [49.0 - 0.0, 64.0 - 1.0, 81.0 - 4.0]
    assert ctl_ramp([1.0, 3.0], days=1) == [None, 2.0]
    with pytest.raises(ValueError, match="days"):
        ctl_ramp(ctl, days=0)


def test_build_daily_load_fills_ramp_and_zone() -> None:
    end = SERIES_START.replace(day=10)
    days = build_daily_load({SERIES_START: 300.0}, {}, start=SERIES_START, end=end)
    assert [d.ctl_ramp_7d for d in days[:7]] == [None] * 7
    assert days[7].ctl_ramp_7d == pytest.approx(days[7].ctl - days[0].ctl)
    # A 300 TSS day from zero drives ATL far above CTL: TSB < -30 on day 1.
    assert days[0].form_zone is FormZone.HIGH_RISK
    assert all(d.form_zone is form_zone(d.tsb, d.ctl) for d in days)
