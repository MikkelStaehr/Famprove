"""`collect-strength`: export the coach's workbook, parse it, replace public.strength_sets."""

import logging
import math
import os
from collections import Counter
from collections.abc import Sequence

from training_load.config import (
    ConfigError,
    GoogleSettings,
    collect_strength_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db.client import Postgrest
from training_load.db.strength_sets import replace_for_sheet
from training_load.domain.strength import StrengthSet, has_block_number
from training_load.http import HttpSend, requests_send
from training_load.sources.google_drive import access_token, download_workbook
from training_load.sources.strength_sheet import ParsedSet, parse_all

log = logging.getLogger(__name__)


def to_domain(parsed: ParsedSet, sheet_id: str) -> StrengthSet:
    """Map a parser dict to StrengthSet: row -> sheet_row, set -> set_no, add sheet_id.

    Raises ValueError naming the tab/row/week when a number is missing or not finite (e.g.
    reps "AMRAP" on an ABS row): this runs before anything is deleted from the database.
    """
    numbers: tuple[tuple[str, object], ...] = (
        ("reps", parsed["reps"]),
        ("logged_kg", parsed["logged_kg"]),
        ("kg", parsed["kg"]),
        ("score", parsed["score"]),
    )
    for column, value in numbers:
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
        ):
            raise ValueError(
                f"{parsed['block']!r} row {parsed['row']} week {parsed['week']}: "
                f"{column} is not a number"
            )
    return StrengthSet(
        sheet_id=sheet_id,
        block=parsed["block"],
        sheet_row=parsed["row"],
        week=parsed["week"],
        set_no=parsed["set"],
        date=parsed["date"],
        type=parsed["type"],
        name=parsed["name"],
        reps=parsed["reps"],
        logged_kg=parsed["logged_kg"],
        kg=parsed["kg"],
        bodyweight=parsed["bodyweight"],
        rpe=parsed["rpe"],
        score=parsed["score"],
    )


def run(google: GoogleSettings, *, bodyweight: float, send: HttpSend, db: Postgrest) -> int:
    """1. access_token + download_workbook(file_id=google.sheet_id) -> xlsx bytes
    2. parse_all(xlsx, bodyweight) -> to_domain each
    3. replace_for_sheet(db, google.sheet_id, sets)  (refuses 0 rows)
    Returns the number of sets written; logs the per-tab counts.
    """
    token = access_token(google.service_account_info)
    xlsx = download_workbook(send, token=token, file_id=google.sheet_id)
    sets = [to_domain(p, google.sheet_id) for p in parse_all(xlsx, bodyweight)]
    unnumbered = sorted({s.block for s in sets if not has_block_number(s.block)})
    if unnumbered:
        log.warning("skipping tabs without a block number: %s", ", ".join(unnumbered))
        sets = [s for s in sets if s.block not in unnumbered]
    replace_for_sheet(db, google.sheet_id, sets)
    for tab, count in sorted(Counter(s.block for s in sets).items()):
        log.info("%s: %d sets", tab, count)
    return len(sets)


def main(argv: Sequence[str] | None = None) -> int:
    """load_dotenv_file -> collect_strength_config(os.environ) -> run -> log summary."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv_file()
    try:
        config = collect_strength_config(os.environ)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    mask_in_ci(config.google.sheet_id, config.google.service_account_info["client_email"])
    send = requests_send()
    db = Postgrest(config.supabase.url, config.supabase.service_key, send)
    written = run(config.google, bodyweight=config.bodyweight, send=send, db=db)
    log.info("strength_sets replaced: %d sets", written)
    return 0
