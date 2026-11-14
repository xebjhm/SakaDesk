"""Rate limit for unauthenticated reject logs (security audit 2026-11-13)."""

from __future__ import annotations

from typing import Any

from backend.services import log_throttle
from backend.services.log_throttle import LogThrottle


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Sink:
    """Collects (event, fields) like a structlog bound method would log them."""

    def __init__(self) -> None:
        self.lines: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, event: str, **fields: Any) -> None:
        self.lines.append((event, fields))

    def events(self) -> list[str]:
        return [event for event, _ in self.lines]


def _throttle(clock: FakeClock, limit: int = 20, window_s: float = 60.0) -> LogThrottle:
    return LogThrottle(limit=limit, window_s=window_s, clock=clock)


def test_defaults_are_twenty_lines_a_minute():
    throttle = LogThrottle()
    assert throttle.limit == 20
    assert throttle.window_s == 60.0


def test_logs_up_to_the_limit_then_suppresses():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock)
    for _ in range(25):
        throttle.log(sink, "api_request_rejected", reason="token")
    assert sink.events() == ["api_request_rejected"] * 20
    assert all(fields == {"reason": "token"} for _, fields in sink.lines)


def test_next_window_reports_the_suppressed_count_first():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock)
    for _ in range(27):
        throttle.log(sink, "api_request_rejected", reason="token")
    clock.now += 60.0
    throttle.log(sink, "api_request_rejected", reason="origin")
    assert sink.lines[20:] == [
        ("log_throttled", {"event_name": "api_request_rejected", "suppressed": 7}),
        ("api_request_rejected", {"reason": "origin"}),
    ]
    # Reported once: the next allowed line carries no summary.
    throttle.log(sink, "api_request_rejected", reason="origin")
    assert sink.events()[-2:] == ["api_request_rejected", "api_request_rejected"]


def test_no_summary_when_nothing_was_suppressed():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock)
    for _ in range(20):
        throttle.log(sink, "health_nonce_rejected")
    clock.now += 61.0
    throttle.log(sink, "health_nonce_rejected")
    assert "log_throttled" not in sink.events()
    assert len(sink.lines) == 21


def test_window_is_still_open_just_before_sixty_seconds():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock)
    for _ in range(20):
        throttle.log(sink, "api_request_rejected")
    clock.now += 59.9
    throttle.log(sink, "api_request_rejected")
    assert len(sink.lines) == 20


def test_suppressed_count_survives_idle_windows():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock, limit=1)
    throttle.log(sink, "api_request_rejected")
    throttle.log(sink, "api_request_rejected")
    throttle.log(sink, "api_request_rejected")
    clock.now += 600.0
    throttle.log(sink, "api_request_rejected")
    assert sink.lines[1] == (
        "log_throttled",
        {"event_name": "api_request_rejected", "suppressed": 2},
    )


def test_each_event_name_has_its_own_budget():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock, limit=2)
    for _ in range(3):
        throttle.log(sink, "api_request_rejected")
        throttle.log(sink, "health_nonce_rejected")
    assert sink.events().count("api_request_rejected") == 2
    assert sink.events().count("health_nonce_rejected") == 2


def test_reset_forgets_windows_and_counts():
    clock, sink = FakeClock(), Sink()
    throttle = _throttle(clock, limit=1)
    throttle.log(sink, "api_request_rejected")
    throttle.log(sink, "api_request_rejected")
    throttle.reset()
    throttle.log(sink, "api_request_rejected")
    assert sink.events() == ["api_request_rejected", "api_request_rejected"]


def test_module_instance_uses_the_monotonic_clock():
    import time

    assert log_throttle.reject_logs.limit == 20
    assert log_throttle.reject_logs._clock is time.monotonic
