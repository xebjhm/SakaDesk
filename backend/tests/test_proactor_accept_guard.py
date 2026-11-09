"""Windows Proactor accept guard (R-i Task 1).

CPython's ``BaseProactorEventLoop._start_serving`` closes the *listening*
socket when one ``AcceptEx`` fails. A browser that resets a connection
before the server accepted it (WinError 64, ERROR_NETNAME_DELETED) therefore
stopped the backend from accepting anything ever again. The guard wraps
``IocpProactor.accept`` so a per-connection reset re-arms accept instead.

``asyncio.windows_events`` cannot be imported off Windows, so these tests drive
the wrapper with a fake ``accept`` on a real (selector) event loop.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from structlog.testing import capture_logs

from backend.services import proactor_resets
from backend.services.proactor_resets import (
    install_proactor_accept_guard,
    retry_reset_accepts,
)


class _Listener:
    def __init__(self, open_: bool = True) -> None:
        self.open = open_

    def fileno(self) -> int:
        return 7 if self.open else -1


class _FakeAccept:
    """Stands in for ``IocpProactor.accept``: one pending future per call."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.futures: list[asyncio.Future[Any]] = []

    def __call__(self, proactor: Any, listener: Any) -> asyncio.Future[Any]:
        fut = self.loop.create_future()
        self.futures.append(fut)
        return fut


def _win_error(winerror: int, message: str) -> OSError:
    """An OSError as Windows raises it (``winerror`` only exists there)."""
    err = OSError(22, message)
    err.winerror = winerror  # type: ignore[attr-defined]
    return err


def _proactor(loop: asyncio.AbstractEventLoop) -> SimpleNamespace:
    return SimpleNamespace(_loop=loop)


async def _settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_successful_accept_passes_through():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].set_result(("conn", ("127.0.0.1", 5000)))
    assert await outer == ("conn", ("127.0.0.1", 5000))
    assert len(fake.futures) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        _win_error(64, "The specified network name is no longer available"),
        _win_error(1236, "connection aborted"),
        ConnectionResetError(10054, "reset by peer"),
        ConnectionAbortedError(10053, "aborted"),
    ],
)
async def test_reset_before_accept_rearms_accept(exc):
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    with capture_logs() as logs:
        outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
        fake.futures[0].set_exception(exc)
        await _settle()
        assert not outer.done()  # the listener keeps waiting for a connection
        assert len(fake.futures) == 2  # accept was re-armed
        fake.futures[1].set_result(("conn", ("127.0.0.1", 5001)))
        assert await outer == ("conn", ("127.0.0.1", 5001))
    (e,) = [e for e in logs if e["event"] == "proactor_accept_reset"]
    assert e["log_level"] == "debug"
    assert e["winerror"] == getattr(exc, "winerror", None)
    assert e["error_type"] == type(exc).__name__


@pytest.mark.asyncio
async def test_other_accept_errors_propagate():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].set_exception(OSError(10055, "no buffer space"))
    with pytest.raises(OSError, match="no buffer space"):
        await outer
    assert len(fake.futures) == 1


@pytest.mark.asyncio
async def test_reset_on_closed_listener_propagates():
    # Shutdown closes the listener; CPython's own handling must then run.
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener(open_=False))
    fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
    with pytest.raises(ConnectionResetError):
        await outer
    assert len(fake.futures) == 1


@pytest.mark.asyncio
async def test_failure_to_rearm_fails_the_accept():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    calls = {"n": 0}

    def flaky(proactor: Any, listener: Any) -> asyncio.Future[Any]:
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError(10038, "not a socket")
        return fake(proactor, listener)

    outer = retry_reset_accepts(flaky)(_proactor(loop), _Listener())
    fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
    with pytest.raises(OSError, match="not a socket"):
        await outer


@pytest.mark.asyncio
async def test_cancelling_the_accept_cancels_the_pending_attempt():
    # _stop_accept_futures cancels the future the loop holds; the pending
    # AcceptEx future must be cancelled too so CPython closes its socket.
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
    await _settle()
    outer.cancel()
    await _settle()
    assert fake.futures[1].cancelled()


@pytest.mark.asyncio
async def test_cancelled_attempt_cancels_the_accept():
    # IocpProactor cancels pending futures of a listener that stopped serving.
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].cancel()
    await _settle()
    assert outer.cancelled()


@pytest.mark.asyncio
async def test_late_attempt_result_after_cancel_is_ignored():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    outer.cancel()
    await _settle()
    assert fake.futures[0].cancelled()
    assert outer.cancelled()


@pytest.mark.asyncio
async def test_attempt_completing_after_outer_was_resolved_is_ignored():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    outer.set_result("already")  # defensive branch: nothing else may win
    fake.futures[0].set_result(("conn", ("127.0.0.1", 5002)))
    await _settle()
    assert outer.result() == "already"


def test_install_is_noop_off_windows():
    with capture_logs() as logs:
        assert install_proactor_accept_guard(platform="linux") is False
    (e,) = [e for e in logs if e["event"] == "proactor_accept_guard"]
    assert e["installed"] is False and e["reason"] == "not_windows"


def test_install_on_windows_patches_once(monkeypatch):
    def accept(self, listener):  # pragma: no cover - never called here
        raise AssertionError

    cls = type("IocpProactor", (), {"accept": accept})
    monkeypatch.setattr(
        proactor_resets,
        "_import_windows_events",
        lambda: SimpleNamespace(IocpProactor=cls),
    )
    with capture_logs() as logs:
        assert install_proactor_accept_guard(platform="win32") is True
        patched = cls.accept
        assert patched is not accept
        assert getattr(patched, proactor_resets._ACCEPT_GUARD_MARK) is True
        assert install_proactor_accept_guard(platform="win32") is False
        assert cls.accept is patched
    reasons = [e.get("reason") for e in logs if e["event"] == "proactor_accept_guard"]
    assert reasons == ["installed", "already_installed"]


@pytest.mark.parametrize("missing", ["module", "class", "method"])
def test_install_on_unsupported_python_is_a_logged_noop(monkeypatch, missing):
    def fake_import():
        if missing == "module":
            raise ImportError("no _overlapped")
        if missing == "class":
            return SimpleNamespace()
        return SimpleNamespace(IocpProactor=type("Bare", (), {}))

    monkeypatch.setattr(proactor_resets, "_import_windows_events", fake_import)
    with capture_logs() as logs:
        assert install_proactor_accept_guard(platform="win32") is False
    (e,) = [e for e in logs if e["event"] == "proactor_accept_guard"]
    assert e["installed"] is False and e["reason"] == "unsupported"


def test_import_windows_events_off_windows_raises():
    with pytest.raises(ImportError):
        proactor_resets._import_windows_events()


@pytest.fixture
def _reset_lifespan_state():
    from backend.services import desktop_bridge, shutdown_state

    yield
    desktop_bridge.set_server_loop(None)
    shutdown_state.reset_for_tests()


@pytest.mark.usefixtures("_reset_lifespan_state")
def test_lifespan_installs_the_accept_guard(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    calls: list[bool] = []
    monkeypatch.setattr(
        proactor_resets,
        "install_proactor_accept_guard",
        lambda: calls.append(True) or True,
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    assert calls == [True]


@pytest.mark.usefixtures("_reset_lifespan_state")
def test_lifespan_survives_a_failing_accept_guard_install(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    def boom() -> bool:
        raise RuntimeError("private API changed")

    monkeypatch.setattr(proactor_resets, "install_proactor_accept_guard", boom)
    with capture_logs() as logs:
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
    (e,) = [e for e in logs if e["event"] == "proactor_accept_guard_failed"]
    assert e["error_type"] == "RuntimeError"
