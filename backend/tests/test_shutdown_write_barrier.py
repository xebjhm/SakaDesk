import asyncio

import pytest

import backend.main as m


def test_quiesce_stops_all_writers(monkeypatch):
    stopped = []

    async def fake_stop(name):
        await asyncio.sleep(0)  # simulate drain
        stopped.append(name)

    monkeypatch.setattr(
        m,
        "_writer_stops",
        [
            lambda: fake_stop("sync"),
            lambda: fake_stop("blog"),
            lambda: fake_stop("search"),
        ],
    )
    asyncio.run(m.quiesce_writers())
    assert set(stopped) == {"sync", "blog", "search"}


def test_quiesce_writers_isolates_a_failing_hook_and_logs_loudly(monkeypatch):
    """I2: one hook raising must not skip the others, and the failure must be
    logged loudly (ERROR), not swallowed -- otherwise a writer could still be
    undrained when `data_lock.release()` runs right after, with nothing in
    the logs to explain why."""
    stopped = []
    errors = []

    async def ok(name):
        stopped.append(name)

    async def boom():
        raise RuntimeError("writer stop exploded")

    monkeypatch.setattr(m.logger, "error", lambda *a, **k: errors.append((a, k)))
    monkeypatch.setattr(
        m,
        "_writer_stops",
        [
            lambda: ok("sync"),
            boom,
            lambda: ok("search"),
        ],
    )

    asyncio.run(m.quiesce_writers())

    # The hooks before AND after the failing one still ran (isolation).
    assert set(stopped) == {"sync", "search"}
    # The failure was logged loudly, not silently swallowed.
    assert len(errors) == 1
    _, kwargs = errors[0]
    assert kwargs.get("exc_info") is True


@pytest.fixture
def lifespan_shutdown():
    """The lifespan's exit sets the process-wide shutdown flag: restore it."""
    from backend.services import shutdown_state

    yield
    shutdown_state.reset_for_tests()


def test_lifespan_quiesces_the_pregen_worker_before_draining_tasks(lifespan_shutdown):
    """M4: media_pregen.stop runs before drain_background_tasks."""
    from fastapi.testclient import TestClient
    from structlog.testing import capture_logs

    from backend.services import media_pregen
    from backend.services.background_tasks import drain_background_tasks

    with capture_logs() as logs:
        with TestClient(m.app):
            stops = list(m._writer_stops)
    assert media_pregen.stop in stops
    assert stops.index(media_pregen.stop) < stops.index(drain_background_tasks)
    # under pytest the worker is never started
    assert {
        "event": "media_pregen_skipped",
        "reason": "env",
        "log_level": "info",
    } in logs


def test_lifespan_starts_the_pregen_worker_when_allowed(monkeypatch, lifespan_shutdown):
    from fastapi.testclient import TestClient

    from backend.services import auto_sync_scheduler, media_pregen
    from backend.services.memories import notify_scheduler

    started: list[list[str]] = []

    class Fake:
        def __init__(self, services):
            pass

        def start(self):
            pass

        async def stop(self):
            pass

    monkeypatch.setattr(auto_sync_scheduler, "scheduler_allowed_in_env", lambda: True)
    monkeypatch.setattr(auto_sync_scheduler, "AutoSyncScheduler", Fake)
    monkeypatch.setattr(notify_scheduler, "MemoriesNotifyScheduler", Fake)
    monkeypatch.setattr(media_pregen, "start", lambda s: started.append(list(s)))
    with TestClient(m.app):
        pass
    assert started and "hinatazaka46" in started[0]
