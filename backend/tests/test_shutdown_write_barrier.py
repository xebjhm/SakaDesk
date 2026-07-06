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
