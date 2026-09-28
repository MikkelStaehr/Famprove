"""HTTP seam shared by every external call (intervals.icu, Google Drive, Supabase PostgREST).

All network I/O goes through an injected ``HttpSend`` callable. Tests pass a fake callable;
no HTTP-mocking library is used.
"""

import time
from collections.abc import Callable, Mapping, Sequence
from typing import Final, Protocol

import requests

USER_AGENT: Final = "famprove-training-load/0.1 (+https://github.com/MikkelStaehr/Famprove)"
"""Explicit UA: Cloudflare in front of intervals.icu blocks some default Python user agents."""

DEFAULT_TIMEOUT_S: Final = 30.0
RETRY_STATUSES: Final = frozenset({429, 502, 503, 504})
MAX_ATTEMPTS: Final = 4

type QueryParams = Sequence[tuple[str, str]]
"""Ordered query pairs. A sequence, not a dict: PostgREST filters repeat column names."""


class HttpResponse(Protocol):
    """The subset of ``requests.Response`` the package relies on."""

    @property
    def status_code(self) -> int: ...

    @property
    def headers(self) -> Mapping[str, str]: ...

    @property
    def content(self) -> bytes: ...

    @property
    def text(self) -> str: ...

    def json(self) -> object: ...


class HttpSend(Protocol):
    """One HTTP request. Production: ``requests_send()``; tests: a fake recording calls."""

    def __call__(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        params: QueryParams | None = None,
        json: object | None = None,
        timeout: float = DEFAULT_TIMEOUT_S,
    ) -> HttpResponse: ...


class HttpError(RuntimeError):
    """Non-2xx response after retries.

    The message carries method, URL (no secrets are ever put in URLs), status and a truncated
    body. It must never include request headers (they hold API keys and tokens).
    """

    def __init__(self, method: str, url: str, status: int, body: str) -> None:
        super().__init__(f"{method} {url} -> HTTP {status}: {body[:500]}")
        self.status = status


def requests_send(session: requests.Session | None = None) -> HttpSend:
    """Adapt ``requests.Session.request`` to ``HttpSend`` (the production default).

    Uses a fresh ``requests.Session`` when none is given.
    """
    s = session or requests.Session()

    def send(
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        params: QueryParams | None = None,
        json: object | None = None,
        timeout: float = DEFAULT_TIMEOUT_S,
    ) -> HttpResponse:
        return s.request(
            method,
            url,
            headers=dict(headers),
            params=list(params) if params is not None else None,
            json=json,
            timeout=timeout,
        )

    return send


def _retry_delay(response: HttpResponse | None, attempt: int) -> float:
    """Numeric Retry-After (capped at 60 s) if present, else 1 s, 2 s, 4 s, ..."""
    if response is not None:
        retry_after = response.headers.get("Retry-After", "")
        try:
            return min(max(float(retry_after), 0.0), 60.0)
        except ValueError:
            pass
    return float(2 ** (attempt - 1))


def request(
    send: HttpSend,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    params: QueryParams | None = None,
    json: object | None = None,
    sleep: Callable[[float], None] = time.sleep,
    max_attempts: int = MAX_ATTEMPTS,
) -> HttpResponse:
    """Send one request with ``User-Agent: USER_AGENT`` and bounded retries.

    Retries only on ``RETRY_STATUSES`` (and connection errors), honouring a numeric
    ``Retry-After`` header, else exponential backoff (1 s, 2 s, 4 s). Any other non-2xx, or
    exhausting ``max_attempts``, raises ``HttpError``. Returns the 2xx response.
    """
    all_headers = {"User-Agent": USER_AGENT, **headers}
    for attempt in range(1, max_attempts + 1):
        try:
            response = send(method, url, headers=all_headers, params=params, json=json)
        except requests.ConnectionError, requests.Timeout:
            if attempt == max_attempts:
                raise
            sleep(_retry_delay(None, attempt))
            continue
        if 200 <= response.status_code < 300:
            return response
        if response.status_code in RETRY_STATUSES and attempt < max_attempts:
            sleep(_retry_delay(response, attempt))
            continue
        raise HttpError(method, url, response.status_code, response.text)
    raise AssertionError("unreachable: the loop always returns or raises")
