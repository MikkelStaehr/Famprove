"""`collect-strength`: export the coach's workbook, parse it, replace public.strength_sets."""

import logging
import math
import os
from collections import Counter
from collections.abc import Sequence
from typing import Final

from training_load.config import (
    ConfigError,
    GoogleSettings,
    collect_strength_config,
    load_dotenv_file,
    mask_in_ci,
)
from training_load.db.client import Postgrest
from training_load.db.strength_sets import replace_for_sheet
from training_load.domain.strength import (
    SectionKey,
    SessionSlot,
    StrengthSet,
    has_block_number,
    number_sessions,
    shared_weeks,
)
from training_load.http import HttpSend, requests_send
from training_load.sources.google_drive import access_token, download_workbook
from training_load.sources.strength_sheet import KG_NOT_A_NUMBER, ParsedSet, parse_all

log = logging.getLogger(__name__)

MAX_ISSUE_SHARE: Final = 0.05
"""Fail the run when more than this share of the prescribed row-weeks (one exercise row in one
week) can't be read: the template has probably changed, and writing a half-parsed sheet would
look like missing training."""


class TooManyIssuesError(RuntimeError):
    """The workbook parsed, but too much of it was unreadable; nothing was written."""


def check_issues(issues: Counter[str], parsed: Sequence[ParsedSet]) -> None:
    """Log unreadable cells per reason (counts only: the Actions logs are public) and raise
    TooManyIssuesError when they exceed MAX_ISSUE_SHARE of the row-weeks tried.

    Unreadable kg still yields sets (kg None), so those row-weeks are already in ``parsed``; the
    other reasons are row-weeks (or rows) that yielded nothing.
    """
    total = sum(issues.values())
    for reason, count in sorted(issues.items()):
        log.warning("%d cells unreadable: %s", count, reason)
    row_weeks = len({(p["block"], p["row"], p["week"]) for p in parsed})
    tried = row_weeks + total - issues[KG_NOT_A_NUMBER]
    if total and total > MAX_ISSUE_SHARE * tried:
        raise TooManyIssuesError(
            f"{total} unreadable cells in {tried} row-weeks (limit {MAX_ISSUE_SHARE:.0%}); "
            "nothing written - check the sheet's layout"
        )


def section_key(parsed: ParsedSet) -> SectionKey:
    return (parsed["block"], parsed["week"], parsed["section"])


def to_domain(parsed: ParsedSet, sheet_id: str, slot: SessionSlot) -> StrengthSet:
    """Map a parser dict to StrengthSet: row -> sheet_row, set -> set_no, add sheet_id and
    the session slot (ISO week start + session number); the sheet's date is not kept.

    Raises ValueError naming the tab/row/week when a number is missing or not finite (e.g.
    reps "AMRAP" on an ABS row): this runs before anything is deleted from the database.
    """
    numbers: tuple[tuple[str, object], ...] = (
        ("reps", parsed["reps"]),
        ("kg", parsed["kg"]),
        ("score", parsed["score"]),
    )
    if parsed["logged_kg"] is not None:
        numbers += (("logged_kg", parsed["logged_kg"]),)
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
        week_start=slot.week_start,
        session=slot.session,
        type=parsed["type"],
        name=parsed["name"],
        reps=parsed["reps"],
        logged_kg=parsed["logged_kg"],
        kg=parsed["kg"],
        bodyweight=parsed["bodyweight"],
        rpe=parsed["rpe"],
        score=parsed["score"],
        prescribed=parsed["prescribed"],
        sets_text=parsed["sets_text"],
        reps_text=parsed["reps_text"],
    )


def run(google: GoogleSettings, *, bodyweight: float, send: HttpSend, db: Postgrest) -> int:
    """1. access_token + download_workbook(file_id=google.sheet_id) -> xlsx bytes
    2. parse_all(xlsx, bodyweight, issues), minus tabs without a block number
    3. check_issues: log unreadable cells per reason; raise above MAX_ISSUE_SHARE
    4. number_sessions per ISO week -> to_domain each
    5. replace_for_sheet(db, google.sheet_id, sets)  (refuses 0 rows)
    Returns the number of sets written; logs the per-tab counts.
    """
    token = access_token(google.service_account_info)
    xlsx = download_workbook(send, token=token, file_id=google.sheet_id)
    issues: Counter[str] = Counter()
    parsed = parse_all(xlsx, bodyweight, issues, counts_issues=has_block_number)
    unnumbered = sorted({p["block"] for p in parsed if not has_block_number(p["block"])})
    if unnumbered:
        log.warning("skipping tabs without a block number: %s", ", ".join(unnumbered))
        parsed = [p for p in parsed if p["block"] not in unnumbered]
    check_issues(issues, parsed)
    slots = number_sessions((section_key(p), p["date"]) for p in parsed)
    if shared := shared_weeks(slots):
        log.warning("%d weeks have sessions from more than one tab", len(shared))
    sets = [to_domain(p, google.sheet_id, slots[section_key(p)]) for p in parsed]
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
