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
