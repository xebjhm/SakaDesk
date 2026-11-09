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
    with pytest.raises(asyncio.TimeoutError):
        async with refresh_gate.hold("yodel"):
            pass
    release.set()
    await task
