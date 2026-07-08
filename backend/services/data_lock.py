"""OS-level exclusive lock over the data directory's writer subsystem.

Exclusive so the OS auto-releases it if the holding process dies (crash-safe).
Held for the lifetime a process owns data-dir writes; released only after that
process has stopped and drained every writer. Reads never take this lock.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import IO, Optional

_IS_WINDOWS = os.name == "nt"


class DataDirLock:
    def __init__(self, lock_path: Path) -> None:
        self._path = lock_path
        self._fh: Optional[IO[bytes]] = None

    @property
    def held(self) -> bool:
        return self._fh is not None

    def acquire(self, timeout: float = 10.0) -> bool:
        if self.held:
            return True
        self._path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + timeout
        # Open (create) the lock file; keep the handle for the lock's lifetime.
        fh = open(self._path, "a+b")
        while True:
            if self._try_lock(fh):
                self._fh = fh
                return True
            if time.monotonic() >= deadline:
                fh.close()
                return False
            time.sleep(0.05)

    def release(self) -> None:
        if self._fh is None:
            return
        try:
            self._unlock(self._fh)
        finally:
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "DataDirLock":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()

    # --- platform primitives ---
    @staticmethod
    def _try_lock(fh: IO[bytes]) -> bool:
        try:
            if _IS_WINDOWS:
                import msvcrt

                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]  # Windows-only
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)  # type: ignore[attr-defined]  # POSIX-only
            return True
        except OSError:
            return False

    @staticmethod
    def _unlock(fh: IO[bytes]) -> None:
        try:
            if _IS_WINDOWS:
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]  # Windows-only
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]  # POSIX-only
        except OSError:
            pass
