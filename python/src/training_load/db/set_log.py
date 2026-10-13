"""public.exercise_set_log, read by Python since 2026-10-13: felt RPE and reps done (the web's one
write path writes it; Python only reads). Timestamps are for splitting the Garmin HR stream
later; nothing here computes from them except the order of rated sets."""

from typing import Final

from training_load.db.client import Postgrest
from training_load.domain.set_feedback import LoggedSet
from training_load.narrow import opt_float, opt_int, opt_str, req_bool, req_date, req_int, req_str

TABLE: Final = "exercise_set_log"
COLUMNS: Final = (
    "date,session_no,row_no,set_no,exercise_id,kind,started_at,ended_at,skipped,felt_rpe,reps_done"
)


def all_logged_sets(db: Postgrest) -> list[LoggedSet]:
    """Every logged set (kind 'set'), oldest first; warm-ups are left out (they never score)."""
    rows = db.select(TABLE, columns=COLUMNS, order="date,session_no,row_no,set_no")
    out: list[LoggedSet] = []
    for r in rows:
        if req_str(r, "kind") != "set":
            continue
        felt = opt_int(r, "felt_rpe")
        out.append(
            LoggedSet(
                day=req_date(r, "date"),
                session=req_int(r, "session_no"),
                row=req_int(r, "row_no"),
                set_no=req_int(r, "set_no"),
                exercise_id=req_int(r, "exercise_id"),
                ended_at=opt_str(r, "ended_at"),
                skipped=req_bool(r, "skipped"),
                felt=felt if felt in (-1, 0, 1) else None,
                reps_done=opt_float(r, "reps_done"),
            )
        )
    return out
