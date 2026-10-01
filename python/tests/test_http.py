"""http.request retry behaviour with a fake HttpSend and a recording sleep."""

import pytest

from conftest import FakeResponse, FakeSend
from training_load.http import USER_AGENT, HttpError, request


def call(send: FakeSend, sleeps: list[float]) -> int:
    response = request(
        send,
        "GET",
        "https://example.test/x",
        headers={"Authorization": "secret"},
        sleep=sleeps.append,
    )
    return response.status_code


def test_sets_user_agent_and_keeps_headers() -> None:
    send = FakeSend(FakeResponse())
    call(send, [])
    assert send.calls[0].headers == {"User-Agent": USER_AGENT, "Authorization": "secret"}


def test_retries_429_honouring_retry_after() -> None:
    sleeps: list[float] = []
    send = FakeSend(FakeResponse(429, headers={"Retry-After": "3"}), FakeResponse(200))
    assert call(send, sleeps) == 200
    assert sleeps == [3.0]


def test_retries_503_with_exponential_backoff() -> None:
    sleeps: list[float] = []
    send = FakeSend(FakeResponse(503), FakeResponse(503), FakeResponse(200))
    assert call(send, sleeps) == 200
    assert sleeps == [1.0, 2.0]


def test_gives_up_after_max_attempts() -> None:
    send = FakeSend(*[FakeResponse(503) for _ in range(4)])
    with pytest.raises(HttpError) as exc:
        call(send, [])
    assert exc.value.status == 503
    assert len(send.calls) == 4


def test_does_not_retry_other_4xx_and_error_excludes_headers() -> None:
    send = FakeSend(FakeResponse(401, body={"error": "bad key"}))
    with pytest.raises(HttpError) as exc:
        call(send, [])
    assert len(send.calls) == 1
    assert "401" in str(exc.value) and "secret" not in str(exc.value)


def test_an_error_body_keeps_only_code_and_message_never_the_failing_row() -> None:
    body = {
        "code": "23514",
        "message": 'new row violates check constraint "e1rm_range"',
        "details": "Failing row contains (2026-10-01, 412.5)",
        "hint": None,
    }
    send = FakeSend(FakeResponse(400, body=body))
    with pytest.raises(HttpError) as exc:
        call(send, [])
    assert "23514" in str(exc.value) and "check constraint" in str(exc.value)
    assert "Failing row" not in str(exc.value) and "412.5" not in str(exc.value)
