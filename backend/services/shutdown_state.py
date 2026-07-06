"""Leaf module holding the process-wide "shutdown has begun" flag (C1c).

Deliberately dependency-free (no imports from `backend.main`,
`backend.services.search_service`, or `backend.api.sync`) so any module can
import it without risking a circular import: `main.py` sets the flag at the
very start of shutdown (before `quiesce_writers()` runs), and read paths that
lazily spawn writer tasks (`search_service.build_full_index`, sync/verify
start entry points) check it to refuse spawning a *new* writer once shutdown
is underway. Without this, a writer created during the shutdown window could
still be running -- and still writing -- after `data_lock.release()`, which
is exactly the guarantee the write barrier exists to uphold.
"""

from __future__ import annotations

_shutting_down = False


def begin_shutdown() -> None:
    """Mark the process as shutting down. Idempotent; never cleared back to
    False -- once a process starts shutting down it does not un-shut-down."""
    global _shutting_down
    _shutting_down = True


def is_shutting_down() -> bool:
    return _shutting_down


def reset_for_tests() -> None:
    """Test-only escape hatch: the flag is module-global/process-wide, so a
    test that exercises shutdown must restore it or every later test in the
    same process would see `is_shutting_down() == True`."""
    global _shutting_down
    _shutting_down = False
