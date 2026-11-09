"""refresh_tray_tooltip and its triggers (immediate, and debounced)."""

import asyncio

import pytest
import pytest_asyncio
from structlog.testing import capture_logs

from backend.services import desktop_bridge, tray_tooltip


@pytest.fixture
def tooltips(monkeypatch):
    """Capture tooltips; pin the unread total and language."""
    seen: list[str] = []
    state = {"unread": 3, "lang": "en", "calls": 0}

    async def fake_total() -> int | None:
        state["calls"] += 1
        return state["unread"]

    async def fake_config() -> dict:
        return {"language": state["lang"]}

    monkeypatch.setattr(tray_tooltip, "unread_total", fake_total)
    monkeypatch.setattr(tray_tooltip, "load_config", fake_config)
    monkeypatch.setattr(
        tray_tooltip, "resolve_ui_language", lambda cfg: cfg.get("language")
    )
    desktop_bridge.set_tray_tooltip_handler(seen.append)
    yield seen, state
    desktop_bridge.set_tray_tooltip_handler(None)


@pytest_asyncio.fixture(autouse=True)
async def _no_leftover_tasks():
    yield
    await tray_tooltip.cancel_pending()


@pytest.mark.asyncio
async def test_refresh_sets_the_localized_tooltip_and_logs_the_count(tooltips):
    seen, state = tooltips
    state["lang"] = "ja"
    with capture_logs() as logs:
        await tray_tooltip.refresh_tray_tooltip()
    assert seen == ["SakaDesk — 未読 3 件"]
    (event,) = [e for e in logs if e["event"] == "tray_tooltip"]
    assert event["unread"] == 3
    assert "SakaDesk" not in repr(event)


@pytest.mark.asyncio
async def test_overlapping_refreshes_cannot_apply_an_older_total_last(
    tooltips, monkeypatch
):
    seen, _ = tooltips
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    totals = iter([5, 2])  # the first computation is the older (stale) one

    async def slow_total() -> int:
        n = next(totals)
        if n == 5:
            first_started.set()
            await release_first.wait()
        return n

    monkeypatch.setattr(tray_tooltip, "unread_total", slow_total)
    older = asyncio.create_task(tray_tooltip.refresh_tray_tooltip())
    await first_started.wait()
    newer = asyncio.create_task(tray_tooltip.refresh_tray_tooltip())
    await asyncio.sleep(0.02)
    assert seen == []  # the newer one waits for the older one to finish
    release_first.set()
    await asyncio.gather(older, newer)
    assert seen == ["SakaDesk — 5 unread", "SakaDesk — 2 unread"]


@pytest.mark.asyncio
async def test_a_failed_refresh_does_not_block_the_next_one(tooltips, monkeypatch):
    seen, _ = tooltips
    calls = {"n": 0}

    async def flaky() -> int:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("x")
        return 4

    monkeypatch.setattr(tray_tooltip, "unread_total", flaky)
    await tray_tooltip.refresh_tray_tooltip()
    await tray_tooltip.refresh_tray_tooltip()
    assert seen == ["SakaDesk — 4 unread"]


@pytest.mark.asyncio
async def test_refresh_idle_text_when_nothing_unread(tooltips):
    seen, state = tooltips
    state["unread"] = 0
    await tray_tooltip.refresh_tray_tooltip()
    assert seen == ["SakaDesk"]


@pytest.mark.asyncio
async def test_refresh_never_raises_and_logs_the_error_type(tooltips, monkeypatch):
    async def boom() -> int:
        raise RuntimeError("secret")

    monkeypatch.setattr(tray_tooltip, "unread_total", boom)
    with capture_logs() as logs:
        await tray_tooltip.refresh_tray_tooltip()
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["error_type"] == "RuntimeError"
    assert "secret" not in repr(logs)


@pytest.mark.asyncio
async def test_unknown_total_keeps_the_previous_tooltip(tooltips, monkeypatch):
    """A failed count must not turn the tooltip into "no unread"."""
    seen, state = tooltips
    await tray_tooltip.refresh_tray_tooltip()
    assert seen == ["SakaDesk — 3 unread"]

    async def unknown() -> None:
        return None

    monkeypatch.setattr(tray_tooltip, "unread_total", unknown)
    with capture_logs() as logs:
        await tray_tooltip.refresh_tray_tooltip()
    assert seen == ["SakaDesk — 3 unread"]  # not replaced by the idle text
    assert not [e for e in logs if e["event"] == "tray_tooltip"]
    (event,) = [e for e in logs if e["event"] == "tray_tooltip_failed"]
    assert event["reason"] == "unread_unavailable"


@pytest.mark.asyncio
async def test_refresh_is_skipped_when_no_tray_handler(tooltips):
    seen, state = tooltips
    desktop_bridge.set_tray_tooltip_handler(None)
    await tray_tooltip.refresh_tray_tooltip()
    assert state["calls"] == 0 and seen == []


@pytest.mark.asyncio
async def test_schedule_runs_a_refresh_in_the_background(tooltips):
    seen, _ = tooltips
    task = tray_tooltip.schedule_refresh()
    assert task is not None
    await task
    assert seen == ["SakaDesk — 3 unread"]


@pytest.mark.asyncio
async def test_schedule_without_a_handler_does_nothing(tooltips):
    desktop_bridge.set_tray_tooltip_handler(None)
    assert tray_tooltip.schedule_refresh() is None
    assert tray_tooltip.schedule_refresh_debounced() is None


@pytest.mark.asyncio
async def test_schedule_outside_a_loop_does_nothing(tooltips):
    # No running loop: run from a plain thread.
    result = await asyncio.to_thread(tray_tooltip.schedule_refresh)
    assert result is None


@pytest.mark.asyncio
async def test_debounce_coalesces_a_burst_into_one_refresh(tooltips, monkeypatch):
    seen, state = tooltips
    monkeypatch.setattr(tray_tooltip, "DEBOUNCE_SECONDS", 0.05)
    for _ in range(5):
        tray_tooltip.schedule_refresh_debounced()
        await asyncio.sleep(0.01)
    assert state["calls"] == 0  # still waiting: each call restarted the timer
    await asyncio.sleep(0.2)
    assert state["calls"] == 1
    assert seen == ["SakaDesk — 3 unread"]


@pytest.mark.asyncio
async def test_debounce_runs_again_for_a_later_burst(tooltips, monkeypatch):
    _, state = tooltips
    monkeypatch.setattr(tray_tooltip, "DEBOUNCE_SECONDS", 0.02)
    tray_tooltip.schedule_refresh_debounced()
    await asyncio.sleep(0.1)
    tray_tooltip.schedule_refresh_debounced()
    await asyncio.sleep(0.1)
    assert state["calls"] == 2


@pytest.mark.asyncio
async def test_cancel_pending_stops_a_waiting_debounce(tooltips, monkeypatch):
    _, state = tooltips
    monkeypatch.setattr(tray_tooltip, "DEBOUNCE_SECONDS", 0.05)
    tray_tooltip.schedule_refresh_debounced()
    await tray_tooltip.cancel_pending()
    await asyncio.sleep(0.1)
    assert state["calls"] == 0


def test_default_debounce_is_two_seconds():
    assert tray_tooltip.DEBOUNCE_SECONDS == 2.0
