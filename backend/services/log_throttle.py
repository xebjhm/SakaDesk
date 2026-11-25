"""Per-event rate limit for the local API's reject logs (security audit 2026-11-13).

Any local process can send requests the API guard refuses, and each refusal
logs one line. Unthrottled, a caller could flood debug.log (50 MB, rotated)
and push out the entries bug reports rely on. ``LogThrottle`` lets at most
``limit`` lines per event name through in each ``window_s``-second window.
Lines over the limit are counted, and the first line allowed in a later
window is preceded by one ``log_throttled`` event (``event_name``,
``suppressed``), so the log still says how many were dropped.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

DEFAULT_LIMIT = 20
DEFAULT_WINDOW_S = 60.0


@dataclass
class _Window:
    start: float
    logged: int = 0
    suppressed: int = 0


class LogThrottle:
    """At most ``limit`` lines per event name per fixed ``window_s`` window."""

    def __init__(
        self,
        limit: int = DEFAULT_LIMIT,
        window_s: float = DEFAULT_WINDOW_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._lock = threading.Lock()
        self._windows: dict[str, _Window] = {}
        self._pending: dict[str, int] = {}  # suppressed in a closed window

    def log(self, log_fn: Callable[..., Any], event: str, **fields: Any) -> None:
        """Call ``log_fn(event, **fields)`` unless ``event`` is over its limit.

        ``log_fn`` is a bound logger method such as ``logger.info``; the
        ``log_throttled`` summary goes through the same method.
        """
        with self._lock:
            now = self._clock()
            window = self._windows.get(event)
            if window is None or now - window.start >= self.window_s:
                if window is not None and window.suppressed:
                    self._pending[event] = (
                        self._pending.get(event, 0) + window.suppressed
                    )
                window = _Window(start=now)
                self._windows[event] = window
            if window.logged >= self.limit:
                window.suppressed += 1
                return
            window.logged += 1
            suppressed = self._pending.pop(event, 0)
        if suppressed:
            log_fn("log_throttled", event_name=event, suppressed=suppressed)
        log_fn(event, **fields)

    def reset(self) -> None:
        """Forget every window and count (tests)."""
        with self._lock:
            self._windows.clear()
            self._pending.clear()


# Shared by the API guard, the Host check and /health in backend/main.py.
reject_logs = LogThrottle()
