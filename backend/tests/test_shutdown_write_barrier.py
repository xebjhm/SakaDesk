import asyncio

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
