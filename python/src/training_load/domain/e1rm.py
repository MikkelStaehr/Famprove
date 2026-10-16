"""The e1RM relation and the 2.5 kg rounding, written once (user, 2026-10-16, slice
cleanup-small; audit #6). Pure and import-free, so planned_load, strength_analysis, planned_sets
and today_kg all use it without an import cycle.

- e1RM = kg x (1 + E1RM_FACTOR x (reps + 10 - RPE)), the sheet formula's own relation; the share
  of e1RM that reps at RPE take is its inverse (pct_of_e1rm).
- round_to_step: the nearest multiple of 2.5, halves up (141.25 -> 142.5), like the sheet's MROUND.
"""

import math
from typing import Final

E1RM_FACTOR: Final = 0.0333
ROUND_TO_KG: Final = 2.5


def e1rm_ratio(reps: float, rpe: float) -> float:
    """1 + E1RM_FACTOR x (reps + 10 - RPE): e1RM / kg for reps at RPE."""
    return 1 + E1RM_FACTOR * (reps + 10 - rpe)


def e1rm(kg: float, reps: float, rpe: float) -> float:
    return kg * e1rm_ratio(reps, rpe)


def pct_of_e1rm(reps: float, rpe: float) -> float:
    """The share of e1RM that reps at RPE take: the inverse of e1rm."""
    return 1 / e1rm_ratio(reps, rpe)


def round_to_step(kg: float, step: float = ROUND_TO_KG) -> float:
    """Nearest multiple of ``step``, halves up (141.25 -> 142.5), like the sheet's MROUND."""
    return math.floor(kg / step + 0.5) * step
