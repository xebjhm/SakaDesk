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
import gc
from types import SimpleNamespace
from typing import Any

import pytest
from structlog.testing import capture_logs

from backend.services import proactor_resets
from backend.services.proactor_resets import (
    install_accept_reset_log_filter,
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
    assert e["synchronous"] is False


class _Scripted:
    """``accept`` that raises the scripted error on given calls, else pends."""

    def __init__(
        self, loop: asyncio.AbstractEventLoop, raises: dict[int, BaseException]
    ) -> None:
        self.fake = _FakeAccept(loop)
        self.raises = raises
        self.calls = 0

    def __call__(self, proactor: Any, listener: Any) -> asyncio.Future[Any]:
        self.calls += 1
        exc = self.raises.get(self.calls)
        if exc is not None:
            raise exc
        return self.fake(proactor, listener)


@pytest.mark.asyncio
async def test_synchronous_reset_on_rearm_rearms_again():
    # AcceptEx raises at once when a reset connection waits in the backlog.
    # That must not reach _start_serving (it would close the listener).
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {2: _win_error(64, "network name deleted")})
    with capture_logs() as logs:
        outer = retry_reset_accepts(accept)(_proactor(loop), _Listener())
        accept.fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
        await _settle()
        assert not outer.done()
        assert accept.calls == 3  # completion reset, sync reset, pending
        accept.fake.futures[1].set_result(("conn", ("127.0.0.1", 5003)))
        assert await outer == ("conn", ("127.0.0.1", 5003))
    resets = [e for e in logs if e["event"] == "proactor_accept_reset"]
    assert [e["synchronous"] for e in resets] == [False, True]
    assert resets[1]["winerror"] == 64
    assert resets[1]["error_type"] == "OSError"
    assert all(e["log_level"] == "debug" for e in resets)


@pytest.mark.asyncio
async def test_synchronous_reset_on_first_call_rearms():
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {1: _win_error(10054, "reset")})
    with capture_logs() as logs:
        outer = retry_reset_accepts(accept)(_proactor(loop), _Listener())
        assert not outer.done()  # no error escapes to _start_serving
        await _settle()
        assert accept.calls == 2
        accept.fake.futures[0].set_result(("conn", ("127.0.0.1", 5004)))
        assert await outer == ("conn", ("127.0.0.1", 5004))
    (e,) = [e for e in logs if e["event"] == "proactor_accept_reset"]
    assert e["synchronous"] is True and e["winerror"] == 10054


@pytest.mark.asyncio
async def test_synchronous_other_error_on_first_call_propagates():
    # Not a per-connection reset: CPython's own handling, synchronously.
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {1: OSError(10038, "not a socket")})
    with capture_logs() as logs:
        with pytest.raises(OSError, match="not a socket"):
            retry_reset_accepts(accept)(_proactor(loop), _Listener())
        await _settle()
    assert accept.calls == 1
    assert not [e for e in logs if e["event"] == "proactor_accept_reset"]


@pytest.mark.asyncio
async def test_synchronous_reset_on_first_call_with_closed_listener_propagates():
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {1: ConnectionResetError(10054, "reset")})
    with pytest.raises(ConnectionResetError):
        retry_reset_accepts(accept)(_proactor(loop), _Listener(open_=False))
    await _settle()
    assert accept.calls == 1


@pytest.mark.asyncio
async def test_non_oserror_while_rearming_fails_the_accept():
    # e.g. the loop is closing: create_task raises RuntimeError. The accept
    # future must fail rather than stay pending forever.
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {2: RuntimeError("Event loop is closed")})
    outer = retry_reset_accepts(accept)(_proactor(loop), _Listener())
    accept.fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
    with pytest.raises(RuntimeError, match="Event loop is closed"):
        await outer


@pytest.mark.asyncio
async def test_cancel_while_waiting_to_rearm_starts_no_attempt():
    loop = asyncio.get_running_loop()
    accept = _Scripted(loop, {1: ConnectionResetError(10054, "reset")})
    outer = retry_reset_accepts(accept)(_proactor(loop), _Listener())
    assert outer.cancel() is True  # no attempt pending yet
    await _settle()
    assert outer.cancelled()
    assert accept.calls == 1


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
async def test_cancel_cancels_the_pending_attempt_synchronously():
    # CPython's _stop_serving cancels the accept future and then closes the
    # listener in the same turn: the AcceptEx must be cancelled before that.
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    assert outer.cancel() is True
    assert fake.futures[0].cancelled()  # no loop turn needed
    assert outer.cancelled()


@pytest.mark.asyncio
async def test_cancel_after_a_rearm_cancels_the_current_attempt_synchronously():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].set_exception(ConnectionResetError(10054, "reset"))
    await _settle()
    outer.cancel()
    assert fake.futures[1].cancelled()


@pytest.mark.asyncio
async def test_cancel_after_the_accept_finished_is_a_noop():
    loop = asyncio.get_running_loop()
    fake = _FakeAccept(loop)
    outer = retry_reset_accepts(fake)(_proactor(loop), _Listener())
    fake.futures[0].set_result(("conn", ("127.0.0.1", 5005)))
    await _settle()
    assert outer.cancel() is False
    assert outer.result() == ("conn", ("127.0.0.1", 5005))


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


def _accept_coro_task(
    loop: asyncio.AbstractEventLoop, exc: BaseException
) -> asyncio.Task[None]:
    """A finished task shaped like ``IocpProactor.accept``'s ``accept_coro``."""

    def accept() -> Any:
        async def accept_coro() -> None:
            raise exc

        return accept_coro()

    task = loop.create_task(accept())
    return task


def _other_task(
    loop: asyncio.AbstractEventLoop, exc: BaseException
) -> asyncio.Task[None]:
    async def handle_request() -> None:
        raise exc

    return loop.create_task(handle_request())


def _noise_context(task: Any, exc: BaseException) -> dict[str, Any]:
    return {
        "message": "Task exception was never retrieved",
        "exception": exc,
        "future": task,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        _win_error(64, "The specified network name is no longer available"),
        ConnectionResetError(10054, "reset by peer"),
    ],
)
async def test_log_filter_downgrades_accept_coro_resets(exc):
    loop = asyncio.get_running_loop()
    task = _accept_coro_task(loop, exc)
    await _settle()
    task.exception()  # retrieved here, so the test itself stays quiet
    previous: list[dict[str, Any]] = []
    handler = proactor_resets.quiet_accept_resets(lambda lp, ctx: previous.append(ctx))
    with capture_logs() as logs:
        handler(loop, _noise_context(task, exc))
    assert previous == []
    (e,) = [e for e in logs if e["event"] == "proactor_accept_reset_task"]
    assert e["log_level"] == "debug"
    assert e["winerror"] == getattr(exc, "winerror", None)
    assert e["error_type"] == type(exc).__name__


def _make_contexts(loop: asyncio.AbstractEventLoop) -> list[dict[str, Any]]:
    reset = ConnectionResetError(10054, "reset")
    other = OSError(10055, "no buffer space")
    plain_future = loop.create_future()
    plain_future.cancel()
    return [
        _noise_context(_other_task(loop, reset), reset),  # not accept_coro
        _noise_context(_accept_coro_task(loop, other), other),  # not a reset
        _noise_context(plain_future, reset),  # no coroutine to identify
        {"message": "Accept failed on a socket", "exception": reset},  # no task
        {"message": "Exception in callback"},  # no exception at all
    ]


@pytest.mark.asyncio
async def test_log_filter_delegates_everything_else_unchanged():
    loop = asyncio.get_running_loop()
    contexts = _make_contexts(loop)
    await _settle()
    for ctx in contexts:
        fut = ctx.get("future")
        if fut is not None and not fut.cancelled():
            fut.exception()  # retrieved: keep the test run quiet
    previous: list[tuple[Any, dict[str, Any]]] = []
    handler = proactor_resets.quiet_accept_resets(
        lambda lp, ctx: previous.append((lp, ctx))
    )
    with capture_logs() as logs:
        for ctx in contexts:
            handler(loop, ctx)
    assert [ctx for _, ctx in previous] == contexts
    assert all(ctx is orig for (_, ctx), orig in zip(previous, contexts))
    assert all(lp is loop for lp, _ in previous)
    assert not [e for e in logs if e["event"] == "proactor_accept_reset_task"]


def test_log_filter_without_previous_handler_uses_the_default():
    seen: list[dict[str, Any]] = []
    fake_loop = SimpleNamespace(default_exception_handler=seen.append)
    handler = proactor_resets.quiet_accept_resets(None)
    ctx = {"message": "Exception in callback", "exception": ValueError("boom")}
    handler(fake_loop, ctx)  # type: ignore[arg-type]
    assert seen == [ctx]


def test_log_filter_install_is_noop_off_windows():
    loop = asyncio.new_event_loop()
    try:
        with capture_logs() as logs:
            assert install_accept_reset_log_filter(loop, platform="linux") is False
        assert loop.get_exception_handler() is None
    finally:
        loop.close()
    (e,) = [e for e in logs if e["event"] == "proactor_accept_log_filter"]
    assert e["installed"] is False and e["reason"] == "not_windows"


def test_log_filter_install_wraps_the_handler_once():
    loop = asyncio.new_event_loop()
    try:
        previous: list[dict[str, Any]] = []
        loop.set_exception_handler(lambda lp, ctx: previous.append(ctx))
        with capture_logs() as logs:
            assert install_accept_reset_log_filter(loop, platform="win32") is True
            installed = loop.get_exception_handler()
            assert getattr(installed, proactor_resets._ACCEPT_LOG_FILTER_MARK)
            assert install_accept_reset_log_filter(loop, platform="win32") is False
            assert loop.get_exception_handler() is installed
        ctx = {"message": "Exception in callback", "exception": ValueError("x")}
        loop.call_exception_handler(ctx)
        assert previous == [ctx]  # the old handler still gets the rest
    finally:
        loop.close()
    reasons = [
        e.get("reason") for e in logs if e["event"] == "proactor_accept_log_filter"
    ]
    assert reasons == ["installed", "already_installed"]


def test_log_filter_catches_the_real_never_retrieved_report():
    # End to end on this Python's own Task: an accept_coro task whose reset
    # nobody retrieves is reported through the loop's exception handler when
    # it is collected. With the filter, that report is a debug breadcrumb.
    loop = asyncio.new_event_loop()
    try:
        previous: list[dict[str, Any]] = []
        loop.set_exception_handler(lambda lp, ctx: previous.append(ctx))
        install_accept_reset_log_filter(loop, platform="win32")
        reset = _win_error(64, "The specified network name is no longer available")
        with capture_logs() as logs:
            task = _accept_coro_task(loop, reset)
            loop.run_until_complete(asyncio.sleep(0))
            assert task.done()
            del task
            gc.collect()
        assert previous == []
        (e,) = [e for e in logs if e["event"] == "proactor_accept_reset_task"]
        assert e["winerror"] == 64
    finally:
        loop.close()


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


@pytest.mark.usefixtures("_reset_lifespan_state")
def test_lifespan_installs_the_accept_log_filter(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    loops: list[asyncio.AbstractEventLoop] = []
    monkeypatch.setattr(
        proactor_resets,
        "install_accept_reset_log_filter",
        lambda loop: loops.append(loop) or True,
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    assert len(loops) == 1 and isinstance(loops[0], asyncio.AbstractEventLoop)


@pytest.mark.usefixtures("_reset_lifespan_state")
def test_lifespan_survives_a_failing_accept_log_filter_install(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    def boom(loop: asyncio.AbstractEventLoop) -> bool:
        raise RuntimeError("no handler API")

    monkeypatch.setattr(proactor_resets, "install_accept_reset_log_filter", boom)
    with capture_logs() as logs:
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
    (e,) = [e for e in logs if e["event"] == "proactor_accept_log_filter_failed"]
    assert e["error_type"] == "RuntimeError"
