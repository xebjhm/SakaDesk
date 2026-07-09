"""Shared retention helper for fire-and-forget `asyncio` background tasks.

`asyncio.create_task(coro())` without keeping a reference to the returned
`Task` is a well-known asyncio pitfall (see the stdlib docs' note on
`create_task`: "the event loop only keeps weak references to tasks... the
task can disappear mid-execution"). `backend/api/ai.py`'s `/ask` endpoint
already has to guard against exactly this for its ask tasks
(`_pending_ask_tasks`); `track_background_task` is the same
add-to-a-retained-module-level-set / discard-via-done-callback /
log-any-exception pattern, extracted so every OTHER fire-and-forget KB-index
hook (`/index/rebuild`, and the sync/blog/transcription post-sync KB-index
hooks) gets the same guarantee without re-implementing it at each call site --
a multi-minute first index (or a slow rebuild) can otherwise be silently
garbage-collected partway through.
"""

from __future__ import annotations

import asyncio
from typing import Any, Coroutine

import structlog

logger = structlog.get_logger(__name__)

# Retained so the event loop's weak task references can never GC one of these
# mid-run; `_on_task_done` discards each entry once it actually finishes.
_background_tasks: set[asyncio.Task] = set()


def track_background_task(coro: Coroutine[Any, Any, Any], *, name: str) -> asyncio.Task:
    """Schedule `coro` via `asyncio.create_task`, retained so it can't be GC'd.

    `name` identifies the task in the exception log (`background_task.failed`)
    if `coro` raises -- callers should pass something specific enough to tell
    hooks apart (e.g. `"index_rebuild"`, `"sync_knowledge_index"`).

    Raises `RuntimeError` if there is no running event loop, same as a bare
    `asyncio.create_task` -- callers that may run outside one (e.g.
    `transcription_service`'s sync-context callers) must still guard this
    themselves.
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(lambda t: _on_task_done(t, name))
    return task


def _on_task_done(task: asyncio.Task, name: str) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("background_task.failed", name=name, exc_info=exc)


async def drain_background_tasks(timeout: float = 5.0) -> None:
    """Shutdown-barrier hook (C1a): cancel every tracked task and wait for it
    to actually finish unwinding before returning.

    This is the app-shutdown write barrier's coverage for the
    `track_background_task` family (e.g. `sync_search_index`, which writes
    `search_index.db`) -- without it, a fire-and-forget writer task could
    still be mid-write when `data_lock.release()` runs. Cancelling and then
    `gather`-ing (rather than just calling `.cancel()`) guarantees this
    returns only once every task is done/cancelled, not merely "asked to
    stop". Bounded by `timeout` so a writer that swallows `CancelledError`
    and hangs cannot deadlock shutdown forever; any task still outstanding
    after the timeout is logged loudly (I2 posture: never fail silently).
    """
    tasks = list(_background_tasks)
    if not tasks:
        return
    for task in tasks:
        task.cancel()
    try:
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=timeout
        )
    except asyncio.TimeoutError:
        still_running = [t for t in tasks if not t.done()]
        logger.error(
            "drain_background_tasks.timed_out",
            timeout=timeout,
            outstanding=len(still_running),
        )
