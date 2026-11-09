"""Close reset sockets cleanly on Windows' Proactor event loop.

The Windows logs show thousands of ``Exception in callback
_ProactorBasePipeTransport._call_connection_lost()`` errors (WinError 10022 /
10054). CPython's ``_call_connection_lost`` notifies the protocol and then, in
a ``finally``, calls ``sock.shutdown(SHUT_RDWR)`` before ``sock.close()``. When
the browser has already reset the connection (WebView2 aborting a media
download), ``shutdown()`` raises, so ``close()`` and the server's ``_detach()``
never run: the socket stays half-open and the server's connection count never
drops.

Why not switch uvicorn to a selector event loop instead: on Windows,
``SelectorEventLoop`` cannot run subprocesses, and SakaDesk's interactive login
(``pysaka.auth.BrowserAuth.login``) is awaited on the uvicorn loop and spawns
Playwright's Node driver with an asyncio subprocess. A selector loop would
break login. So the Proactor loop stays and this guard finishes the cleanup the
failed ``shutdown()`` skipped.

The guard only acts when the wrapped call raised ``OSError`` *before* the
transport marked itself closed; any other error, or one raised after the
cleanup completed, propagates unchanged. If a future CPython stops raising
here, the wrapper is a pass-through.

Python 3.13 / 3.14 still need it: their ``_call_connection_lost`` only
tolerates ``ConnectionError`` around ``shutdown()``, and WSAEINVAL (WinError
10022) is a plain ``OSError``, not a ``ConnectionError``. The guard depends on
private CPython names; when they are missing it logs
``proactor_reset_guard installed=False reason="unsupported"`` and does
nothing, so it can never stop the app from starting.

A second guard covers accepting. CPython's
``BaseProactorEventLoop._start_serving`` (3.12 through 3.14) treats any
``OSError`` from a finished ``AcceptEx`` as fatal and closes the *listening*
socket. A browser that resets a connection before the server has accepted it
(WinError 64, ERROR_NETNAME_DELETED) therefore stopped the backend from
accepting any new connection for the rest of the session. ``retry_reset_accepts``
wraps ``IocpProactor.accept`` so that such a per-connection reset re-arms
accept instead (``proactor_accept_reset`` breadcrumb), whether ``AcceptEx``
reports it on completion or raises it synchronously (a reset connection
already waiting in the backlog). Other errors, and resets that arrive after
the listener was closed (shutdown), still reach CPython's own handling.
``install_proactor_accept_guard`` installs it with the same Windows-only,
missing-names-tolerant rules as the reset guard (breadcrumb
``proactor_accept_guard``).

CPython's internal ``accept_coro`` task still re-raises each such reset and
reports it at ERROR as "Task exception was never retrieved", which would put
one misleading error line in the log per re-armed reset.
``install_accept_reset_log_filter`` wraps the loop's exception handler so that
exactly that report becomes a debug ``proactor_accept_reset_task`` breadcrumb;
every other context reaches the previous handler unchanged (breadcrumb
``proactor_accept_log_filter``).

A synchronous reset re-arms accept on the next loop turn, so a backlog full of
reset connections would spin the loop without yielding to I/O. After
``SYNC_RESET_BACKOFF_AFTER`` consecutive synchronous resets the re-arm is
delayed by ``SYNC_RESET_BACKOFF_S`` (``call_later``) instead, and one
``proactor_accept_reset_backoff`` breadcrumb marks the streak. The streak ends
when an attempt completes (a connection, or a reset reported on completion).

The accept socket that a failed ``AcceptEx`` call created is not closed here:
CPython never closes it explicitly, so it is freed by reference counting / GC
once the failed attempt is dropped. Triage should not expect a close event for
those sockets.
"""

from __future__ import annotations

import asyncio
import functools
import importlib
import inspect
import sys
from types import ModuleType
from typing import Any, Callable

import structlog

logger = structlog.get_logger(__name__)

_GUARD_MARK = "_saka_reset_guard"
_ACCEPT_GUARD_MARK = "_saka_accept_guard"
_ACCEPT_LOG_FILTER_MARK = "_saka_accept_log_filter"

# Errors that mean one pending connection went away before accept completed
# (not that the listener is broken): ERROR_NETNAME_DELETED,
# ERROR_CONNECTION_ABORTED, WSAECONNABORTED, WSAECONNRESET.
_PER_CONNECTION_ACCEPT_ERRORS = frozenset({64, 1236, 10053, 10054})

# Consecutive synchronous resets after which re-arming backs off, and by how long.
SYNC_RESET_BACKOFF_AFTER = 50
SYNC_RESET_BACKOFF_S = 0.05

CallConnectionLost = Callable[[Any, "BaseException | None"], None]
Accept = Callable[[Any, Any], "asyncio.Future[Any]"]
ExceptionHandler = Callable[["asyncio.AbstractEventLoop", "dict[str, Any]"], object]


def _detach(server: Any, transport: Any) -> None:
    """Call ``Server._detach`` with whichever signature this Python has.

    CPython 3.12 takes no argument; 3.13+ takes the transport.
    """
    try:
        takes_transport = bool(inspect.signature(server._detach).parameters)
    except (TypeError, ValueError):
        takes_transport = False
    if takes_transport:
        server._detach(transport)
    else:
        server._detach()


def tolerate_reset_on_close(original: CallConnectionLost) -> CallConnectionLost:
    """Wrap ``_call_connection_lost`` so a reset during ``shutdown()`` still
    closes the socket and detaches the transport from its server."""

    @functools.wraps(original)
    def guarded(self: Any, exc: BaseException | None) -> None:
        try:
            original(self, exc)
        except OSError as err:
            if self._called_connection_lost:
                raise  # cleanup finished; the error is not the shutdown reset
            close_failed = False
            sock = self._sock
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    close_failed = True  # already gone; nothing left to release
                self._sock = None
            server = self._server
            if server is not None:
                _detach(server, self)
                self._server = None
            self._called_connection_lost = True
            context = err.__context__
            logger.debug(
                "proactor_reset_on_close",
                errno=err.errno,
                winerror=getattr(err, "winerror", None),
                close_failed=close_failed,
                context_type=(type(context).__name__ if context is not None else None),
            )

    setattr(guarded, _GUARD_MARK, True)
    return guarded


def install_proactor_reset_guard(platform: str = sys.platform) -> bool:
    """Install the guard on Windows' Proactor transport (idempotent).

    Returns True when this call installed it. No-op off Windows, and when
    this Python lacks the private names it patches (``reason="unsupported"``).
    Logs one ``proactor_reset_guard`` breadcrumb with the decision.
    """
    if platform != "win32":
        logger.debug("proactor_reset_guard", installed=False, reason="not_windows")
        return False

    from asyncio import proactor_events

    # Private CPython API: reached via getattr/setattr (not in typeshed), and
    # tolerated missing so another Python never breaks startup.
    cls = getattr(proactor_events, "_ProactorBasePipeTransport", None)
    current = getattr(cls, "_call_connection_lost", None) if cls else None
    if cls is None or current is None:
        logger.warning("proactor_reset_guard", installed=False, reason="unsupported")
        return False
    if getattr(current, _GUARD_MARK, False):
        logger.debug(
            "proactor_reset_guard", installed=False, reason="already_installed"
        )
        return False
    setattr(cls, "_call_connection_lost", tolerate_reset_on_close(current))
    logger.info("proactor_reset_guard", installed=True, reason="installed")
    return True


def _is_connection_reset(exc: BaseException) -> bool:
    """True when an accept error concerns only the connection being accepted."""
    if isinstance(exc, (ConnectionResetError, ConnectionAbortedError)):
        return True
    return getattr(exc, "winerror", None) in _PER_CONNECTION_ACCEPT_ERRORS


class _AcceptFuture(asyncio.Future[Any]):
    """The future ``retry_reset_accepts`` returns.

    ``cancel()`` cancels the pending ``AcceptEx`` attempt *before* this
    future, in the same call. CPython's ``_stop_serving`` cancels the accept
    future and then closes the listener; unpatched, that cancel reaches the
    overlapped ``AcceptEx`` before the close, and this keeps that order.
    """

    _inner: asyncio.Future[Any] | None = None

    def cancel(self, msg: Any = None) -> bool:
        if self.done():
            return False
        inner = self._inner
        if inner is not None:
            inner.cancel()
        return super().cancel(msg)


def retry_reset_accepts(original: Accept) -> Accept:
    """Wrap ``IocpProactor.accept`` so a connection reset before accept
    completed re-arms accept instead of failing the listener.

    A per-connection reset can arrive two ways: as the result of the
    overlapped ``AcceptEx`` (``synchronous=False``), or raised by ``AcceptEx``
    itself when a reset connection is already waiting in the backlog
    (``synchronous=True``). Both log ``proactor_accept_reset`` and re-arm
    accept on the next loop turn while the listener is still open. After
    ``SYNC_RESET_BACKOFF_AFTER`` consecutive synchronous resets the re-arm is
    delayed by ``SYNC_RESET_BACKOFF_S`` and one ``proactor_accept_reset_backoff``
    breadcrumb is logged for the streak; the streak ends when an attempt
    completes.

    The returned future resolves with the first connection that is accepted.
    It fails with any error that is not a per-connection reset, with a reset
    once the listener is closed, and with any non-``OSError`` exception raised
    while re-arming. On the first call, such an error raised synchronously
    propagates from this call, as it did before. Cancelling the returned
    future cancels the pending attempt first; a cancelled attempt cancels it.
    """

    @functools.wraps(original)
    def guarded(self: Any, listener: Any) -> asyncio.Future[Any]:
        loop = self._loop
        outer = _AcceptFuture(loop=loop)
        sync_streak = 0  # consecutive synchronous resets

        def is_retryable(exc: BaseException) -> bool:
            return _is_connection_reset(exc) and listener.fileno() != -1

        def log_reset(exc: BaseException, synchronous: bool) -> None:
            logger.debug(
                "proactor_accept_reset",
                winerror=getattr(exc, "winerror", None),
                error_type=type(exc).__name__,
                synchronous=synchronous,
            )

        def rearm_after_sync_reset(err: BaseException) -> None:
            nonlocal sync_streak
            sync_streak += 1
            log_reset(err, synchronous=True)
            if sync_streak < SYNC_RESET_BACKOFF_AFTER:
                loop.call_soon(rearm)
                return
            if sync_streak == SYNC_RESET_BACKOFF_AFTER:
                logger.info(
                    "proactor_accept_reset_backoff",
                    after=SYNC_RESET_BACKOFF_AFTER,
                    delay_s=SYNC_RESET_BACKOFF_S,
                )
            loop.call_later(SYNC_RESET_BACKOFF_S, rearm)

        def start_attempt() -> None:
            inner = original(self, listener)
            outer._inner = inner
            inner.add_done_callback(on_attempt_done)

        def rearm() -> None:
            if outer.done():
                return  # cancelled (stopped serving) while waiting to re-arm
            try:
                start_attempt()
            except OSError as err:
                if not is_retryable(err):
                    outer.set_exception(err)
                    return
                rearm_after_sync_reset(err)
            except Exception as err:  # e.g. RuntimeError from a closing loop
                if not outer.done():
                    outer.set_exception(err)

        def on_attempt_done(inner: asyncio.Future[Any]) -> None:
            nonlocal sync_streak
            sync_streak = 0  # an attempt completed: the synchronous streak is over
            if outer.done():
                return
            if inner.cancelled():
                outer.cancel()
                return
            exc = inner.exception()
            if exc is None:
                outer.set_result(inner.result())
                return
            if not is_retryable(exc):
                outer.set_exception(exc)
                return
            log_reset(exc, synchronous=False)
            loop.call_soon(rearm)

        try:
            start_attempt()
        except OSError as err:
            if not is_retryable(err):
                raise  # CPython's own handling, exactly as before
            rearm_after_sync_reset(err)
        return outer

    setattr(guarded, _ACCEPT_GUARD_MARK, True)
    return guarded


def _is_accept_reset_noise(context: dict[str, Any]) -> bool:
    """True for CPython's "Task exception was never retrieved" report of a
    per-connection reset from ``IocpProactor.accept``'s ``accept_coro`` task.
    """
    exc = context.get("exception")
    if exc is None or not _is_connection_reset(exc):
        return False
    get_coro = getattr(context.get("future"), "get_coro", None)
    if get_coro is None:
        return False
    qualname = getattr(get_coro(), "__qualname__", None)
    return isinstance(qualname, str) and qualname.split(".")[-1] == "accept_coro"


def quiet_accept_resets(previous: ExceptionHandler | None) -> ExceptionHandler:
    """Build a loop exception handler that downgrades accept-reset noise.

    CPython's ``accept_coro`` task re-raises the reset of an ``AcceptEx`` it
    awaited, and nothing retrieves that exception, so every reset that
    ``retry_reset_accepts`` re-arms is also reported at ERROR as "Task
    exception was never retrieved". Only that report (see
    ``_is_accept_reset_noise``) becomes a debug ``proactor_accept_reset_task``
    breadcrumb. Every other context goes to ``previous``, or to
    ``loop.default_exception_handler`` when there was none.
    """

    def handler(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        if _is_accept_reset_noise(context):
            exc = context["exception"]
            logger.debug(
                "proactor_accept_reset_task",
                winerror=getattr(exc, "winerror", None),
                error_type=type(exc).__name__,
            )
            return
        if previous is not None:
            previous(loop, context)
        else:
            loop.default_exception_handler(context)

    setattr(handler, _ACCEPT_LOG_FILTER_MARK, True)
    return handler


def install_accept_reset_log_filter(
    loop: asyncio.AbstractEventLoop, platform: str = sys.platform
) -> bool:
    """Install ``quiet_accept_resets`` on ``loop`` (idempotent).

    Returns True when this call installed it. No-op off Windows. Wraps the
    loop's current exception handler. Logs one ``proactor_accept_log_filter``
    breadcrumb with the decision.
    """
    if platform != "win32":
        logger.debug(
            "proactor_accept_log_filter", installed=False, reason="not_windows"
        )
        return False
    current = loop.get_exception_handler()
    if getattr(current, _ACCEPT_LOG_FILTER_MARK, False):
        logger.debug(
            "proactor_accept_log_filter", installed=False, reason="already_installed"
        )
        return False
    loop.set_exception_handler(quiet_accept_resets(current))
    logger.info("proactor_accept_log_filter", installed=True, reason="installed")
    return True


def _import_windows_events() -> ModuleType:
    """Import ``asyncio.windows_events`` (raises ImportError off Windows)."""
    return importlib.import_module("asyncio.windows_events")


def install_proactor_accept_guard(platform: str = sys.platform) -> bool:
    """Install the accept guard on Windows' ``IocpProactor`` (idempotent).

    Returns True when this call installed it. No-op off Windows, and when
    this Python lacks the private names it patches (``reason="unsupported"``).
    Logs one ``proactor_accept_guard`` breadcrumb with the decision.
    """
    if platform != "win32":
        logger.debug("proactor_accept_guard", installed=False, reason="not_windows")
        return False
    try:
        windows_events = _import_windows_events()
    except ImportError:
        windows_events = None
    cls = getattr(windows_events, "IocpProactor", None)
    current = getattr(cls, "accept", None) if cls else None
    if cls is None or current is None:
        logger.warning("proactor_accept_guard", installed=False, reason="unsupported")
        return False
    if getattr(current, _ACCEPT_GUARD_MARK, False):
        logger.debug(
            "proactor_accept_guard", installed=False, reason="already_installed"
        )
        return False
    setattr(cls, "accept", retry_reset_accepts(current))
    logger.info("proactor_accept_guard", installed=True, reason="installed")
    return True
