import asyncio
import threading
import time

import pytest
from structlog.testing import capture_logs

from backend.services import desktop_bridge as db


class Host:
    def __init__(
        self, *, raise_on: str | None = None, block: threading.Event | None = None
    ):
        self.calls: list[tuple] = []
        self.raise_on, self.block = raise_on, block

    def _do(self, op, *args, result=None):
        self.calls.append((op, *args))
        if self.block is not None:
            self.block.wait(5)
        if self.raise_on == op:
            raise RuntimeError("boom")
        return result

    def available(self):
        return self._do("available", result=True)

    def ensure(self):
        return self._do("ensure", result=True)

    def start(self, call_id):
        return self._do("start", call_id, result=True)

    def reveal(self, call_id):
        return self._do("reveal", call_id, result=True)

    def hide(self, call_id):
        return self._do("hide", call_id)

    def cancel(self, call_id):
        return self._do("cancel", call_id)

    def deliver_heard(self, target):
        return self._do("deliver_heard", target, result="delivered")


@pytest.fixture(autouse=True)
def _clear():
    db.set_call_popup_host(None)
    yield
    db.set_call_popup_host(None)
    db.shutdown_call_popup_executor()


def test_no_host_logs_once_and_returns_safe_values():
    with capture_logs() as logs:
        assert db.call_popup_available() is False
        assert asyncio.run(db.call_popup_start(1)) is False
        assert asyncio.run(db.call_popup_reveal(1)) is False
        assert (
            asyncio.run(db.call_popup_deliver_heard(db.HeardTarget("s", "p", 1)))
            == "no_host"
        )
        asyncio.run(db.call_popup_hide(1))
        asyncio.run(db.call_popup_cancel(1))
        db.call_popup_ensure()
    assert [e for e in logs if e["event"] == "call_popup_unavailable"] == [
        {"event": "call_popup_unavailable", "log_level": "info", "reason": "no_host"}
    ]


def test_host_calls_pass_through():
    host = Host()
    db.set_call_popup_host(host)
    assert db.call_popup_available() is True
    assert asyncio.run(db.call_popup_start(7)) is True
    assert asyncio.run(db.call_popup_reveal(7)) is True
    asyncio.run(db.call_popup_hide(7))
    asyncio.run(db.call_popup_cancel(7))
    t = db.HeardTarget(
        "hinatazaka46", "日向坂46/messages/34 金村 美玖/58 金村 美玖", 10
    )
    assert asyncio.run(db.call_popup_deliver_heard(t)) == "delivered"
    assert (
        ("start", 7) in host.calls
        and ("reveal", 7) in host.calls
        and ("hide", 7) in host.calls
        and ("cancel", 7) in host.calls
        and ("deliver_heard", t) in host.calls
    )


def test_raising_host_logs_op_and_type_only():
    db.set_call_popup_host(Host(raise_on="start"))
    with capture_logs() as logs:
        assert asyncio.run(db.call_popup_start(1)) is False
    (e,) = [e for e in logs if e["event"] == "call_popup_bridge_failed"]
    assert e["op"] == "start" and e["error_type"] == "RuntimeError"


def test_raising_deliver_heard_returns_error():
    db.set_call_popup_host(Host(raise_on="deliver_heard"))
    assert (
        asyncio.run(db.call_popup_deliver_heard(db.HeardTarget("s", "p", 1))) == "error"
    )


def test_hanging_host_times_out(monkeypatch):
    gate = threading.Event()
    db.set_call_popup_host(Host(block=gate))
    monkeypatch.setattr(db, "BRIDGE_TIMEOUT_S", 0.05)

    async def run() -> bool:
        try:
            return await db.call_popup_reveal(1)
        finally:
            # Release the hung worker before asyncio.run joins the executor.
            gate.set()

    with capture_logs() as logs:
        assert asyncio.run(run()) is False
    (e,) = [e for e in logs if e["event"] == "call_popup_bridge_failed"]
    assert e["op"] == "reveal" and e["reason"] == "timeout"


def test_start_uses_the_longer_timeout(monkeypatch):
    seen = []

    async def fake_wait_for(aw, timeout):
        seen.append(timeout)
        return await aw

    db.set_call_popup_host(Host())
    monkeypatch.setattr(db.asyncio, "wait_for", fake_wait_for)
    asyncio.run(db.call_popup_start(1))
    asyncio.run(db.call_popup_reveal(1))
    assert seen == [db.BRIDGE_START_TIMEOUT_S, db.BRIDGE_TIMEOUT_S]


def test_ensure_runs_on_a_thread_and_survives_errors():
    host = Host(raise_on="ensure")
    db.set_call_popup_host(host)
    with capture_logs() as logs:
        db.call_popup_ensure()
        for _ in range(100):
            if any(e["event"] == "call_popup_bridge_failed" for e in logs):
                break
            threading.Event().wait(0.01)
    assert ("ensure",) in host.calls
    assert any(
        e["event"] == "call_popup_bridge_failed" and e["op"] == "ensure" for e in logs
    )


def test_available_false_when_host_raises():
    db.set_call_popup_host(Host(raise_on="available"))
    assert db.call_popup_available() is False


def test_host_calls_run_on_their_own_executor():
    names: list[str] = []

    class Named(Host):
        def reveal(self, call_id):
            names.append(threading.current_thread().name)
            return True

    db.set_call_popup_host(Named())

    async def run():
        await asyncio.gather(*(db.call_popup_reveal(i) for i in range(6)))

    asyncio.run(run())
    assert names and all(n.startswith("call_popup_host") for n in names)
    assert len(set(names)) <= db.HOST_EXECUTOR_WORKERS


def test_two_timeouts_in_a_row_make_the_popup_unavailable(monkeypatch):
    class Blocking(Host):
        def available(self):  # a flag read, as the contract requires
            self.calls.append(("available",))
            return True

    gate = threading.Event()
    host = Blocking(block=gate)
    db.set_call_popup_host(host)
    monkeypatch.setattr(db, "BRIDGE_START_TIMEOUT_S", 0.05)
    monkeypatch.setattr(db, "BRIDGE_TIMEOUT_S", 0.05)
    assert db.call_popup_available() is True

    async def run():
        try:
            assert await db.call_popup_start(1) is False
            assert db.call_popup_available() is True  # one timeout is not enough
            assert await db.call_popup_cancel(1) is None
        finally:
            gate.set()

    with capture_logs() as logs:
        asyncio.run(run())
    calls_before = len(host.calls)
    assert db.call_popup_available() is False  # a flag read: the host is not asked
    assert len(host.calls) == calls_before
    assert [e for e in logs if e["event"] == "call_popup_unavailable"] == [
        {
            "event": "call_popup_unavailable",
            "log_level": "warning",
            "reason": "host_timeouts",
            "timeouts": 2,
        }
    ]


def test_a_completed_call_resets_the_timeout_count(monkeypatch):
    gate = threading.Event()
    host = Host()
    db.set_call_popup_host(host)
    monkeypatch.setattr(db, "BRIDGE_TIMEOUT_S", 0.05)

    async def run():
        try:
            host.block = gate
            await db.call_popup_hide(1)
            host.block = None
            # The blocked worker still holds one of the two threads.
            assert await db.call_popup_reveal(1) is True
            host.block = gate
            await db.call_popup_hide(1)
        finally:
            gate.set()

    asyncio.run(run())
    assert db.call_popup_available() is True


def test_shutdown_does_not_wait_for_a_blocked_call(monkeypatch):
    gate = threading.Event()
    db.set_call_popup_host(Host(block=gate))
    monkeypatch.setattr(db, "BRIDGE_TIMEOUT_S", 0.05)

    async def run():
        await db.call_popup_hide(1)

    try:
        asyncio.run(run())
        t0 = time.monotonic()
        db.shutdown_call_popup_executor()
        assert time.monotonic() - t0 < 1.0
        db.shutdown_call_popup_executor()  # idempotent
    finally:
        gate.set()
    # A later call gets a fresh executor.
    db.set_call_popup_host(Host())
    assert asyncio.run(db.call_popup_reveal(2)) is True
