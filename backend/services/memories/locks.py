"""Per-key asyncio locks for single-flight work in Memories.

``asyncio.Lock`` binds to the event loop it first waits on, so locks are kept
per running loop (weakly, so a closed loop's locks are dropped with it).
"""

from __future__ import annotations

import asyncio
import weakref
from collections.abc import Hashable

_locks: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, dict[Hashable, asyncio.Lock]
] = weakref.WeakKeyDictionary()


def keyed_lock(key: Hashable) -> asyncio.Lock:
    """The lock for ``key`` on the running loop (created on first use)."""
    per_loop = _locks.setdefault(asyncio.get_running_loop(), {})
    lock = per_loop.get(key)
    if lock is None:
        lock = per_loop[key] = asyncio.Lock()
    return lock
