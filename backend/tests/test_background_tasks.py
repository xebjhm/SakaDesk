"""Tests for `backend.services.background_tasks.track_background_task` -- the
shared fire-and-forget task retention helper (pwave-2 Fix 4).

`asyncio.create_task(coro())` with no retained reference lets the event loop's
weak task reference get garbage-collected mid-run; `/api/ai/ask` already
guards against this for ask tasks (`_pending_ask_tasks` in `backend/api/ai.py`)
-- these tests cover the extracted, shared version used by `/index/rebuild`
and the sync/blog/transcription KB-index hooks.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.services import background_tasks as bt


@pytest.mark.asyncio
async def test_track_background_task_retains_task_while_pending_and_discards_on_success():
    gate = asyncio.Event()

    async def slow() -> str:
        await gate.wait()
        return "done"

    task = bt.track_background_task(slow(), name="slow_task")

    # Retained while still running -- this is the whole point: nothing else
    # in this test holds a reference to `task`, yet it must not be eligible
    # for GC.
    assert task in bt._background_tasks
    assert not task.done()

    gate.set()
    result = await task
    await asyncio.sleep(0)  # let the done-callback run

    assert result == "done"
    assert task not in bt._background_tasks


@pytest.mark.asyncio
async def test_track_background_task_logs_exception_via_done_callback_and_discards(
    monkeypatch: pytest.MonkeyPatch,
):
    """The done-callback must retrieve the failed task's exception itself
    (logging it) WITHOUT this test awaiting/catching the task directly --
    proving retrieval happens inside `_on_task_done`, which is what avoids
    asyncio's "Task exception was never retrieved" warning on GC."""
    logged: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        bt.logger, "error", lambda event, **kwargs: logged.append((event, kwargs))
    )

    async def boom() -> None:
        raise RuntimeError("kaboom")

    task = bt.track_background_task(boom(), name="boom_task")
    assert task in bt._background_tasks

    for _ in range(10):
        await asyncio.sleep(0)
        if task.done():
            break
    assert task.done()
    await asyncio.sleep(0)  # done-callbacks run via call_soon, one tick later

    assert task not in bt._background_tasks
    assert len(logged) == 1
    event, kwargs = logged[0]
    assert event == "background_task.failed"
    assert kwargs["name"] == "boom_task"
    assert isinstance(kwargs["exc_info"], RuntimeError)


@pytest.mark.asyncio
async def test_track_background_task_does_not_log_on_success(
    monkeypatch: pytest.MonkeyPatch,
):
    logged: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        bt.logger, "error", lambda event, **kwargs: logged.append((event, kwargs))
    )

    async def fine() -> None:
        return None

    task = bt.track_background_task(fine(), name="fine_task")
    await task
    await asyncio.sleep(0)

    assert logged == []
    assert task not in bt._background_tasks


@pytest.mark.asyncio
async def test_track_background_task_discards_on_cancellation_without_logging(
    monkeypatch: pytest.MonkeyPatch,
):
    logged: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        bt.logger, "error", lambda event, **kwargs: logged.append((event, kwargs))
    )

    async def forever() -> None:
        await asyncio.Event().wait()

    task = bt.track_background_task(forever(), name="cancelled_task")
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0)

    assert logged == []
    assert task not in bt._background_tasks


def test_track_background_task_raises_runtime_error_with_no_running_loop():
    """Same contract as bare `asyncio.create_task`: callers that may run
    outside an event loop (e.g. `transcription_service`'s sync-context
    callers) must still guard this themselves."""

    async def noop() -> None:
        return None

    coro = noop()
    try:
        with pytest.raises(RuntimeError):
            bt.track_background_task(coro, name="no_loop_task")
    finally:
        coro.close()
