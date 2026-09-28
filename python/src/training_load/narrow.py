"""Narrow decoded JSON values to typed fields. Shared by sources/ (API payloads) and db/ (rows).

Every helper raises ``ValueError`` naming the field (never the value) when the type is wrong.
``bool`` is rejected where a number is expected (it is an ``int`` subclass in Python).
"""

from collections.abc import Mapping
from datetime import date, datetime


def _get(obj: Mapping[str, object], key: str) -> object:
    if key not in obj:
        raise ValueError(f"missing field {key!r}")
    return obj[key]


def req_str(obj: Mapping[str, object], key: str) -> str:
    value = _get(obj, key)
    if not isinstance(value, str):
        raise ValueError(f"field {key!r} must be a string")
    return value


def opt_str(obj: Mapping[str, object], key: str) -> str | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"field {key!r} must be a string or null")
    return value


def opt_float(obj: Mapping[str, object], key: str) -> float | None:
    value = obj.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"field {key!r} must be a number or null")
    return float(value)


def req_float(obj: Mapping[str, object], key: str) -> float:
    value = opt_float(obj, key)
    if value is None:
        raise ValueError(f"field {key!r} must be a number")
    return value


def opt_int(obj: Mapping[str, object], key: str) -> int | None:
    """Accepts integral floats too (JSON has one number type); rounds non-integral ones."""
    value = opt_float(obj, key)
    return None if value is None else round(value)


def req_int(obj: Mapping[str, object], key: str) -> int:
    value = opt_int(obj, key)
    if value is None:
        raise ValueError(f"field {key!r} must be a number")
    return value


def req_bool(obj: Mapping[str, object], key: str) -> bool:
    value = _get(obj, key)
    if not isinstance(value, bool):
        raise ValueError(f"field {key!r} must be a boolean")
    return value


def req_date(obj: Mapping[str, object], key: str) -> date:
    try:
        return date.fromisoformat(req_str(obj, key)[:10])
    except ValueError as exc:
        raise ValueError(f"field {key!r} must be an ISO date") from exc


def req_naive_datetime(obj: Mapping[str, object], key: str) -> datetime:
    """ISO datetime as a naive wall-clock value (any offset is dropped, not converted)."""
    try:
        return datetime.fromisoformat(req_str(obj, key)).replace(tzinfo=None)
    except ValueError as exc:
        raise ValueError(f"field {key!r} must be an ISO datetime") from exc


def json_objects(payload: object, what: str) -> list[Mapping[str, object]]:
    """A JSON array of objects, else ValueError."""
    if not isinstance(payload, list):
        raise ValueError(f"{what}: expected a JSON array")
    objects: list[Mapping[str, object]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError(f"{what}: expected an array of objects")
        objects.append(item)
    return objects
