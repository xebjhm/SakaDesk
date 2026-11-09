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


def _lock_for(service: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    entry = _locks.get(service)
    if entry is None or entry[0] is not loop:
        entry = (loop, asyncio.Lock())
        _locks[service] = entry
    return entry[1]


@asynccontextmanager
async def hold(service: str) -> AsyncIterator[None]:
    """Hold ``service``'s refresh lock; raises ``TimeoutError`` after ``GATE_WAIT_SECONDS``."""
    lock = _lock_for(service)
    contended = lock.locked()
    try:
        async with asyncio.timeout(GATE_WAIT_SECONDS):
            await lock.acquire()
    except TimeoutError:
        logger.warning(
            "session_renew_wait_timeout", service=service, waited_s=GATE_WAIT_SECONDS
        )
        raise
    if contended:
        logger.info("session_renew_waited", service=service)
    try:
        yield
    finally:
        lock.release()
