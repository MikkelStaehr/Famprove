"""public.blocks: upsert on (sheet_id, name) + prune keys that are no longer derived."""

from collections.abc import Sequence
from typing import Final, TypedDict

from training_load.db.client import Postgrest
from training_load.domain.strength import Block
from training_load.narrow import req_str

TABLE: Final = "blocks"


class BlockRow(TypedDict):
    sheet_id: str
    name: str
    block_no: int
    start_date: str  # ISO date
    end_date: str | None
    deload_start: str | None


def to_row(block: Block) -> BlockRow:
    return BlockRow(
        sheet_id=block.sheet_id,
        name=block.name,
        block_no=block.block_no,
        start_date=block.start_date.isoformat(),
        end_date=block.end_date.isoformat() if block.end_date else None,
        deload_start=block.deload_start.isoformat() if block.deload_start else None,
    )


def stored_keys(db: Postgrest) -> set[tuple[str, str]]:
    """Every stored (sheet_id, name), paginated, ordered by the primary key."""
    rows = db.select(TABLE, columns="sheet_id,name", order="sheet_id,name")
    return {(req_str(row, "sheet_id"), req_str(row, "name")) for row in rows}


def sync_blocks(db: Postgrest, blocks: Sequence[Block]) -> None:
    """Upsert ``blocks`` (on_conflict=sheet_id,name), then delete stored keys not in ``blocks``.

    Stale keys come from ``stored_keys`` diffed in Python; each is deleted with eq filters
    (tab names may contain characters that are awkward in a PostgREST in-list).
    """
    if blocks:
        db.upsert(TABLE, [to_row(b) for b in blocks], on_conflict="sheet_id,name")
    stale = stored_keys(db) - {(b.sheet_id, b.name) for b in blocks}
    for sheet_id, name in sorted(stale):
        db.delete(TABLE, [("sheet_id", f"eq.{sheet_id}"), ("name", f"eq.{name}")])
