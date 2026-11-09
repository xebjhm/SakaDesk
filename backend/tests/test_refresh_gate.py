"""Single-flight refresh gate (spec B1 §2)."""

import asyncio

import pytest
from structlog.testing import capture_logs

from backend.services import refresh_gate


@pytest.mark.asyncio
async def test_same_service_runs_one_at_a_time():
    order: list[str] = []

    async def worker(tag: str):
        async with refresh_gate.hold("hinatazaka46"):
            order.append(f"{tag}-in")
            await asyncio.sleep(0.01)
            order.append(f"{tag}-out")

    with capture_logs() as logs:
        await asyncio.gather(worker("a"), worker("b"))
    assert order == ["a-in", "a-out", "b-in", "b-out"]
    assert [e["event"] for e in logs].count("session_renew_waited") == 1


@pytest.mark.asyncio
async def test_different_services_do_not_block():
    entered = asyncio.Event()

    async def holder():
        async with refresh_gate.hold("hinatazaka46"):
            await entered.wait()

    task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    async with refresh_gate.hold("sakurazaka46"):
        entered.set()
    await task


@pytest.mark.asyncio
async def test_wait_times_out(monkeypatch):
    monkeypatch.setattr(refresh_gate, "GATE_WAIT_SECONDS", 0.01)
    release = asyncio.Event()

    async def holder():
        async with refresh_gate.hold("yodel"):
            await release.wait()

    task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    with capture_logs() as logs:
        with pytest.raises(asyncio.TimeoutError):
            async with refresh_gate.hold("yodel"):
                pass
    timeouts = [e for e in logs if e["event"] == "session_renew_wait_timeout"]
    assert len(timeouts) == 1
    assert timeouts[0]["service"] == "yodel"
    assert timeouts[0]["log_level"] == "warning"
    release.set()
    await task
    # The timed-out waiter must not have left the lock held.
    async with refresh_gate.hold("yodel"):
        pass


@pytest.mark.asyncio
async def test_lock_released_when_body_raises():
    with pytest.raises(RuntimeError):
        async with refresh_gate.hold("raiser"):
            raise RuntimeError("boom")
    async with refresh_gate.hold("raiser"):
        pass


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_leak_lock(monkeypatch):
    monkeypatch.setattr(refresh_gate, "GATE_WAIT_SECONDS", 5.0)
    release = asyncio.Event()

    async def holder():
        async with refresh_gate.hold("cancelled"):
            await release.wait()

    async def waiter():
        async with refresh_gate.hold("cancelled"):
            pass

    holder_task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    waiter_task = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    with capture_logs() as logs:
        waiter_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter_task
    assert not [e for e in logs if e["event"] == "session_renew_wait_timeout"]
    release.set()
    await holder_task
    async with refresh_gate.hold("cancelled"):
        pass
