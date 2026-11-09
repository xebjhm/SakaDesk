"""Per-service single-flight gate for access-token refreshes (spec B1 §2).

Every refresh rotates the session cookie, so two concurrent refreshes for one
service can invalidate each other. ``AuthService.get_status`` /
``refresh_if_needed`` and ``SyncService._authenticated_client`` all refresh
inside ``hold(service)``; a caller that waited re-reads the stored token and
usually finds it already renewed. Locks are created lazily and re-created when
the running loop changes (tests, restarts).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog

logger = structlog.get_logger(__name__)

GATE_WAIT_SECONDS = 120.0

_locks: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Lock]] = {}
_queued: dict[str, int] = {}


def _lock_for(service: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    entry = _locks.get(service)
    if entry is None or entry[0] is not loop:
        entry = (loop, asyncio.Lock())
        _locks[service] = entry
    return entry[1]


def _abandon_acquire(lock: asyncio.Lock, acquire: asyncio.Task[bool]) -> None:
    """Undo a pending or completed ``lock.acquire()`` whose waiter gave up.

    On Python 3.9-3.11 ``wait_for`` can time out after the acquire already
    succeeded; releasing here keeps the lock from being held forever.
    """
    if acquire.done() and not acquire.cancelled():
        lock.release()
    else:
        acquire.cancel()


@asynccontextmanager
async def hold(service: str) -> AsyncIterator[None]:
    """Hold ``service``'s refresh lock; raises ``asyncio.TimeoutError`` after ``GATE_WAIT_SECONDS``.

    A timeout logs ``session_renew_wait_timeout``. Cancellation while waiting
    releases or cancels the pending acquire and re-raises without that log.
    """
    lock = _lock_for(service)
    # ensure_future defers the acquire, so count queued callers synchronously;
    # otherwise a second caller would see the lock free and skip the wait log.
    contended = lock.locked() or _queued.get(service, 0) > 0
    _queued[service] = _queued.get(service, 0) + 1
    acquire = asyncio.ensure_future(lock.acquire())
    try:
        await asyncio.wait_for(asyncio.shield(acquire), GATE_WAIT_SECONDS)
    except asyncio.TimeoutError:
        _abandon_acquire(lock, acquire)
        logger.warning(
            "session_renew_wait_timeout", service=service, waited_s=GATE_WAIT_SECONDS
        )
        raise
    except asyncio.CancelledError:
        _abandon_acquire(lock, acquire)
        raise
    finally:
        _queued[service] -= 1
    if contended:
        logger.info("session_renew_waited", service=service)
    try:
        yield
    finally:
        lock.release()
