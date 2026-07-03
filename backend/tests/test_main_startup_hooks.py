"""Tests for `backend.main`'s deferred startup sweeps -- specifically
`_deferred_kb_initial_build`'s deliberate startup delay (KB review Finding 1).

Before this fix, `_deferred_kb_initial_build` fired with ZERO delay while its
sibling `_deferred_blog_backup` deliberately waited 60s for real sync/backup
hooks to run first -- so the KB startup sweep routinely raced a live
sync-completion hook indexing the SAME service right after app launch. Both
sweeps now share one `_STARTUP_DEFERRED_DELAY_S` constant/mechanism.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

import backend.main as main_module


@pytest.mark.asyncio
async def test_deferred_kb_initial_build_awaits_the_shared_startup_delay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    monkeypatch.setattr(main_module.asyncio, "sleep", fake_sleep)
    fake_kb_enabled = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "backend.services.knowledge_service.kb_enabled", fake_kb_enabled
    )

    await main_module._deferred_kb_initial_build()

    # The delay must be awaited BEFORE the enabled-check/fan-out, and must be
    # the SAME constant `_deferred_blog_backup` uses -- not a shorter/zero one.
    assert sleep_calls == [main_module._STARTUP_DEFERRED_DELAY_S]
    fake_kb_enabled.assert_awaited_once()


class _StopAfterSleep(Exception):
    """Sentinel raised from a faked `asyncio.sleep` to bail out immediately
    after the delay is observed, before the (irrelevant, real-I/O-touching)
    rest of the function body runs. `_deferred_blog_backup` awaits its sleep
    BEFORE its try/except, so this propagates straight to the test."""


@pytest.mark.asyncio
async def test_deferred_blog_backup_uses_the_same_shared_delay_constant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Guards the asymmetry the review flagged from regressing the other way:
    `_deferred_blog_backup` must keep using the SAME shared constant, not a
    hardcoded literal that could drift out of sync with the KB sweep's."""
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        raise _StopAfterSleep

    monkeypatch.setattr(main_module.asyncio, "sleep", fake_sleep)

    with pytest.raises(_StopAfterSleep):
        await main_module._deferred_blog_backup()

    assert sleep_calls == [main_module._STARTUP_DEFERRED_DELAY_S]


@pytest.mark.asyncio
async def test_deferred_kb_initial_build_sweeps_after_the_delay_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sanity companion to the delay test: once the (mocked, instant) delay
    elapses and the KB is enabled, the sweep still actually fans out via
    `schedule_initial_build_all`."""

    async def fake_sleep(seconds: float) -> None:
        return None

    monkeypatch.setattr(main_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(
        "backend.services.knowledge_service.kb_enabled", AsyncMock(return_value=True)
    )
    fake_sweep = AsyncMock()
    monkeypatch.setattr(
        "backend.services.knowledge_service.schedule_initial_build_all", fake_sweep
    )

    await main_module._deferred_kb_initial_build()

    fake_sweep.assert_awaited_once()
