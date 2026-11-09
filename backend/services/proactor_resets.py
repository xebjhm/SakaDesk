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
accept instead (``proactor_accept_reset`` breadcrumb). Other errors, and resets
that arrive after the listener was closed (shutdown), still reach CPython's
own handling. ``install_proactor_accept_guard`` installs it with the same
Windows-only, missing-names-tolerant rules as the reset guard (breadcrumb
``proactor_accept_guard``).
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

# Errors that mean one pending connection went away before accept completed
# (not that the listener is broken): ERROR_NETNAME_DELETED,
# ERROR_CONNECTION_ABORTED, WSAECONNABORTED, WSAECONNRESET.
_PER_CONNECTION_ACCEPT_ERRORS = frozenset({64, 1236, 10053, 10054})

CallConnectionLost = Callable[[Any, "BaseException | None"], None]
Accept = Callable[[Any, Any], "asyncio.Future[Any]"]


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


def retry_reset_accepts(original: Accept) -> Accept:
    """Wrap ``IocpProactor.accept`` so a connection reset before accept
    completed re-arms accept instead of failing the listener.

    The returned future resolves with the first connection that is accepted.
    It fails only for errors that are not per-connection resets, or when the
    listener is already closed. Cancelling it cancels the pending attempt.
    """

    @functools.wraps(original)
    def guarded(self: Any, listener: Any) -> asyncio.Future[Any]:
        outer: asyncio.Future[Any] = self._loop.create_future()
        pending: list[asyncio.Future[Any]] = []

        def attempt() -> None:
            inner = original(self, listener)
            pending[:] = [inner]
            inner.add_done_callback(on_attempt_done)

        def on_attempt_done(inner: asyncio.Future[Any]) -> None:
            if outer.done():
                return
            if inner.cancelled():
                outer.cancel()
                return
            exc = inner.exception()
            if exc is None:
                outer.set_result(inner.result())
                return
            if not (_is_connection_reset(exc) and listener.fileno() != -1):
                outer.set_exception(exc)
                return
            logger.debug(
                "proactor_accept_reset",
                winerror=getattr(exc, "winerror", None),
                error_type=type(exc).__name__,
            )
            try:
                attempt()
            except OSError as err:
                outer.set_exception(err)

        def on_outer_done(fut: asyncio.Future[Any]) -> None:
            if fut.cancelled():
                for inner in pending:
                    inner.cancel()

        attempt()  # a synchronous failure propagates as it did before
        outer.add_done_callback(on_outer_done)
        return outer

    setattr(guarded, _ACCEPT_GUARD_MARK, True)
    return guarded


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
