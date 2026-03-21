"""
Thread-safe progress tracker for sync operations.
Mimics tqdm behavior for HTTP polling.

Supports per-service progress tracking for multi-service sync.
"""

import time
from threading import Lock
from typing import Optional


class SyncProgress:
    """Thread-safe progress tracker (like tqdm for HTTP polling)"""

    def __init__(self):
        self._lock = Lock()
        self.reset()

    def reset(self):
        """Reset all progress state"""
        with self._lock:
            self._state = "idle"
            self._phase = ""
            self._phase_name = ""
            self._phase_number = 0
            self._completed = 0
            self._total = 0
            self._detail = ""
            self._detail_extra = ""
            self._speed_unit = ""
            self._phase_start: Optional[float] = None
            self._error: Optional[str] = None

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
            self._speed_unit = speed_unit
            self._phase_start = time.time()
            self._detail = ""
            self._detail_extra = ""

    def update(
        self,
        n: int = 1,
        detail: Optional[str] = None,
        detail_extra: Optional[str] = None,
    ):
        """Atomic increment like tqdm.update(n)"""
        with self._lock:
            self._completed += n
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
            if detail is not None:
                self._detail = detail

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

    def error(self, message: str):
        """Mark sync as errored"""
        with self._lock:
            self._state = "error"
            self._phase = "error"
            self._phase_name = "Error"
            self._error = message
            self._detail = message

    def get_status(self) -> dict:
        """Get current status (thread-safe read for polling)"""
        with self._lock:
            elapsed = time.time() - self._phase_start if self._phase_start else 0
            speed = self._completed / elapsed if elapsed > 0 else 0
            remaining = self._total - self._completed
            eta = int(remaining / speed) if speed > 0 else None

            return {
                "state": self._state,
                "phase": self._phase,
                "phase_name": self._phase_name,
                "phase_number": self._phase_number,
                "completed": self._completed,
                "total": self._total,
                "elapsed_seconds": int(elapsed),
                "eta_seconds": eta,
                "speed": speed,
                "speed_unit": self._speed_unit,
                "detail": self._detail,
                "detail_extra": self._detail_extra,
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
