"""
Thread-safe progress tracker for sync operations.
Mimics tqdm behavior for HTTP polling.

Supports per-service progress tracking for multi-service sync.
"""

import time
from collections import deque
from threading import Lock
from typing import Optional

# S2 (spec 2026-11-10): speed is measured over a recent window, not since the
# phase began, so stalls and bursts do not dominate it.
SPEED_WINDOW_SECONDS = 30.0
# At most one speed sample per this many seconds (updates arrive per item).
_SAMPLE_MIN_GAP_SECONDS = 0.5
# An ETA is shown only in the media phase, and only after this much evidence.
ETA_MIN_ITEMS = 20
ETA_MIN_SECONDS = 10.0
# Phases whose unit of work has a predictable cost; every other phase reports
# eta_reason "not_estimable" (scanning, discovering, collecting metadata...).
_ETA_PHASES = frozenset({"downloading"})


# SD-CONTRACT-07: sync failures were historically smuggled as magic sentinel
# strings through the human-readable ``detail`` field (the frontend string-compared
# ``detail === 'SESSION_EXPIRED'`` to drive the re-login flow). That overloads one
# field as both display text and machine code — any reword silently breaks the
# flow. We now expose a separate, structured ``error_code`` in the status payload.
# Known sentinels map to a stable code here so existing callers that still pass the
# sentinel as the message keep working; new callers can pass ``code`` explicitly.
_SENTINEL_ERROR_CODES: dict[str, str] = {
    "SESSION_EXPIRED": "session_expired",
    "REFRESH_FAILED": "refresh_failed",
    "CANCELLED": "cancelled",
}


class SyncProgress:
    """Thread-safe progress tracker (like tqdm for HTTP polling)"""

    def __init__(self):
        self._lock = Lock()
        # Incremented by every reset(), i.e. once per started run, so a client
        # that was not watching can tell that a run happened in between.
        self._run_id = 0
        self.reset()

    def reset(self):
        """Reset all progress state and start a new run (``run_id`` + 1)"""
        with self._lock:
            self._run_id += 1
            # Set by the run's first start_phase: time spent queued is not elapsed.
            self._run_started_at: Optional[float] = None
            self._queue_position: Optional[int] = None
            self._failed = 0
            self._samples: deque[tuple[float, int]] = deque()
            self._state = "idle"
            self._phase = ""
            self._phase_name = ""
            self._phase_number = 0
            self._completed = 0
            self._total = 0
            self._detail = ""
            self._detail_extra = ""
            self._detail_code: Optional[str] = None
            self._speed_unit = ""
            self._phase_start: Optional[float] = None
            self._error: Optional[str] = None
            self._error_code: Optional[str] = None
            self._result: Optional[dict] = None

    def start_phase(
        self,
        phase: str,
        phase_name: str,
        phase_number: int,
        total: int,
        speed_unit: str,
    ):
        """Start a new phase with given parameters"""
        with self._lock:
            self._state = "running"
            self._phase = phase
            self._phase_name = phase_name
            self._phase_number = phase_number
            self._total = total
            self._completed = 0
            self._failed = 0
            self._queue_position = None
            self._samples.clear()
            self._speed_unit = speed_unit
            self._phase_start = time.time()
            if self._run_started_at is None:
                self._run_started_at = self._phase_start
            self._detail = ""
            self._detail_extra = ""
            self._detail_code = None

    def extend_total(self, n: int):
        """Grow the current phase's total (e.g. room authors found mid-phase)."""
        with self._lock:
            self._total += n

    def set_detail_code(self, code: Optional[str]):
        """Set a machine-readable detail (e.g. "scanning_history") the frontend
        localises; None clears it. Cleared by start_phase, complete and error."""
        with self._lock:
            self._detail_code = code

    def update(
        self,
        n: int = 1,
        detail: Optional[str] = None,
        detail_extra: Optional[str] = None,
    ):
        """Atomic increment like tqdm.update(n)"""
        with self._lock:
            self._completed += n
            self._sample()
            if detail is not None:
                self._detail = detail
            if detail_extra is not None:
                self._detail_extra = detail_extra

    def set_detail(self, detail: str, detail_extra: str = ""):
        """Update detail without incrementing counter"""
        with self._lock:
            self._detail = detail
            self._detail_extra = detail_extra

    def set_completed(self, completed: int, detail: Optional[str] = None):
        """Set absolute completed count (for chunked updates)"""
        with self._lock:
            self._completed = completed
            self._sample()
            if detail is not None:
                self._detail = detail

    def add_failed(self, n: int = 1):
        """Count items that were processed but failed (shown next to the bar)."""
        with self._lock:
            self._failed += n

    def set_queued(self, position: int):
        """Mark this service as waiting in the sync queue at ``position`` (1-based)."""
        with self._lock:
            self._state = "queued"
            self._phase = "queued"
            self._phase_name = "Queued"
            self._queue_position = position

    def _sample(self) -> None:
        # Caller holds the lock. Keep (time, completed) samples for the window speed.
        now = time.time()
        if self._samples and now - self._samples[-1][0] < _SAMPLE_MIN_GAP_SECONDS:
            self._samples[-1] = (self._samples[-1][0], self._completed)
        else:
            self._samples.append((now, self._completed))
        while self._samples and now - self._samples[0][0] > SPEED_WINDOW_SECONDS:
            self._samples.popleft()

    def _speed(self, now: float, phase_elapsed: float) -> float:
        # Caller holds the lock. Window speed from the oldest sample in the
        # window to now; below 2 samples, the phase average.
        while self._samples and now - self._samples[0][0] > SPEED_WINDOW_SECONDS:
            self._samples.popleft()
        if len(self._samples) >= 2:
            t0, c0 = self._samples[0]
            span = now - t0
            if span > 0:
                return max(self._completed - c0, 0) / span
        return self._completed / phase_elapsed if phase_elapsed > 0 else 0.0

    def set_result(self, result: dict):
        """Attach a structured summary (rendered by the frontend, i18n-safe)."""
        with self._lock:
            self._result = result

    def complete(self):
        """Mark sync as complete"""
        with self._lock:
            self._state = "complete"
            self._phase = "complete"
            self._phase_name = "Complete"
            # Don't override phase_number — keep it as the last real phase
            self._completed = self._total
            self._detail = "Sync complete!"
            self._detail_extra = ""
            self._detail_code = None

    def error(self, message: str, code: Optional[str] = None):
        """Mark sync as errored.

        ``message`` stays the human-readable ``detail``; ``code`` is a stable
        machine code exposed separately as ``error_code`` (SD-CONTRACT-07). When
        ``code`` is omitted, a known sentinel ``message`` (e.g. "SESSION_EXPIRED")
        is mapped to its code so the frontend can key off ``error_code`` without
        the caller having to change.
        """
        with self._lock:
            self._state = "error"
            self._phase = "error"
            self._phase_name = "Error"
            self._error = message
            self._detail = message
            self._detail_code = None
            self._error_code = code or _SENTINEL_ERROR_CODES.get(message)

    def get_status(self) -> dict:
        """Get current status (thread-safe read for polling)"""
        with self._lock:
            now = time.time()
            elapsed = now - self._phase_start if self._phase_start else 0
            run_elapsed = now - self._run_started_at if self._run_started_at else 0
            speed = self._speed(now, elapsed)
            remaining = max(self._total - self._completed, 0)
            eta: Optional[int] = None
            eta_reason: Optional[str] = None
            if self._state == "running":
                if self._phase not in _ETA_PHASES:
                    eta_reason = "not_estimable"
                elif (
                    self._completed < ETA_MIN_ITEMS
                    or elapsed < ETA_MIN_SECONDS
                    or speed <= 0
                ):
                    eta_reason = "warming_up"
                else:
                    eta = int(remaining / speed)

            return {
                "run_id": self._run_id,
                "state": self._state,
                "phase": self._phase,
                "phase_name": self._phase_name,
                "phase_number": self._phase_number,
                "completed": self._completed,
                "total": self._total,
                "elapsed_seconds": int(elapsed),
                "run_elapsed_seconds": int(run_elapsed),
                "eta_seconds": eta,
                "eta_reason": eta_reason,
                "failed": self._failed,
                "queue_position": self._queue_position,
                "speed": speed,
                "speed_unit": self._speed_unit,
                "detail": self._detail,
                "detail_extra": self._detail_extra,
                "detail_code": self._detail_code,
                "error_code": self._error_code,
                "result": self._result,
            }


class ProgressManager:
    """Manages per-service progress trackers for multi-service sync."""

    def __init__(self):
        self._lock = Lock()
        self._progress_by_service: dict[str, SyncProgress] = {}

    def get(self, service: str) -> SyncProgress:
        """Get or create progress tracker for a service."""
        with self._lock:
            if service not in self._progress_by_service:
                self._progress_by_service[service] = SyncProgress()
            return self._progress_by_service[service]

    def get_all_status(self) -> dict[str, dict]:
        """Get status for all services (for multi-service polling)."""
        with self._lock:
            return {
                service: progress.get_status()
                for service, progress in self._progress_by_service.items()
            }

    def get_running_services(self) -> list[str]:
        """Get list of services currently syncing."""
        with self._lock:
            return [
                service
                for service, progress in self._progress_by_service.items()
                if progress.get_status()["state"] == "running"
            ]


# Global manager for per-service progress tracking
progress_manager = ProgressManager()

# Legacy: single progress instance for backwards compatibility with
# frontend that doesn't yet use per-service progress endpoints.
# TECH_DEBT: Migrate frontend to /api/sync/progress/{service} and remove this.
progress = SyncProgress()
