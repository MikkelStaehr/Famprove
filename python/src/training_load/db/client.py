"""Minimal PostgREST client for Supabase (no supabase-py, no RPC).

Auth headers: always ``apikey: <key>``; add ``Authorization: Bearer <key>`` only for a legacy
JWT key (starts with "eyJ"). New ``sb_secret_...`` keys go in ``apikey`` only.

Reads are paginated: PostgREST caps responses (max_rows, default 1000), so ``select`` pages
with limit/offset under a stable ``order`` and stops using the total from ``Content-Range``
(requested via ``Prefer: count=exact``), never by "short page", because the server cap may
be smaller than PAGE_SIZE.
"""

from collections.abc import Mapping, Sequence
from typing import Final

from training_load.http import HttpSend, QueryParams, request
from training_load.narrow import json_objects

PAGE_SIZE: Final = 1000
WRITE_CHUNK: Final = 500
LEGACY_JWT_PREFIX: Final = "eyJ"

type Filters = QueryParams
"""PostgREST filter pairs, e.g. [("sheet_id", "eq.abc"), ("date", "lt.2026-01-01")]."""

type JsonRow = dict[str, object]
"""A decoded JSON object from PostgREST; table modules narrow it to domain types."""


class EmptyFilterError(ValueError):
    """Refusing an unfiltered DELETE (Supabase also rejects it via pg-safeupdate)."""


def auth_headers(key: str) -> dict[str, str]:
    """apikey always; Authorization: Bearer only when key starts with LEGACY_JWT_PREFIX."""
    headers = {"apikey": key}
    if key.startswith(LEGACY_JWT_PREFIX):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _content_range_total(header: str | None) -> int:
    """Total from ``Content-Range: 0-999/1234`` (or ``*/0``)."""
    total = (header or "").rpartition("/")[2]
    if not total.isdigit():
        raise RuntimeError("PostgREST response lacks an exact Content-Range total")
    return int(total)


class Postgrest:
    """Talks to ``{supabase_url}/rest/v1``. All calls go through ``http.request`` (retries)."""

    def __init__(self, supabase_url: str, key: str, send: HttpSend) -> None:
        self._base = supabase_url.rstrip("/") + "/rest/v1"
        self._key = key
        self._send = send

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {**auth_headers(self._key), "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def select(
        self, table: str, *, columns: str, order: str, filters: Filters = ()
    ) -> list[JsonRow]:
        """All matching rows across pages. ``order`` must be unique (e.g. the primary key)
        so limit/offset pages neither skip nor repeat rows."""
        rows: list[JsonRow] = []
        while True:
            params = [
                ("select", columns),
                *filters,
                ("order", order),
                ("limit", str(PAGE_SIZE)),
                ("offset", str(len(rows))),
            ]
            response = request(
                self._send,
                "GET",
                f"{self._base}/{table}",
                headers=self._headers("count=exact"),
                params=params,
            )
            page = json_objects(response.json(), f"select {table}")
            rows.extend(dict(row) for row in page)
            total = _content_range_total(response.headers.get("Content-Range"))
            if len(rows) >= total:
                return rows
            if not page:
                raise RuntimeError(f"select {table}: pagination stopped at {len(rows)}/{total}")

    def _post(
        self,
        table: str,
        rows: Sequence[Mapping[str, object]],
        *,
        prefer: str,
        params: QueryParams = (),
    ) -> None:
        for start in range(0, len(rows), WRITE_CHUNK):
            request(
                self._send,
                "POST",
                f"{self._base}/{table}",
                headers=self._headers(prefer),
                params=params,
                json=[dict(row) for row in rows[start : start + WRITE_CHUNK]],
            )

    def insert(self, table: str, rows: Sequence[Mapping[str, object]]) -> None:
        """POST in WRITE_CHUNK batches, ``Prefer: return=minimal``.

        Every row must have the same keys (PostgREST bulk-insert rule): emit nulls explicitly.
        """
        self._post(table, rows, prefer="return=minimal")

    def upsert(self, table: str, rows: Sequence[Mapping[str, object]], *, on_conflict: str) -> None:
        """POST ?on_conflict=<cols> with ``Prefer: resolution=merge-duplicates,return=minimal``,
        in WRITE_CHUNK batches. Same identical-keys rule as ``insert``."""
        self._post(
            table,
            rows,
            prefer="resolution=merge-duplicates,return=minimal",
            params=[("on_conflict", on_conflict)],
        )

    def delete(self, table: str, filters: Filters) -> None:
        """DELETE matching rows. Raises EmptyFilterError when ``filters`` is empty."""
        if not filters:
            raise EmptyFilterError(f"refusing an unfiltered DELETE on {table}")
        request(
            self._send,
            "DELETE",
            f"{self._base}/{table}",
            headers=self._headers("return=minimal"),
            params=filters,
        )
