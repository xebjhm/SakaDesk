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
"""

from __future__ import annotations

import functools
import inspect
import sys
from typing import Any, Callable

import structlog

logger = structlog.get_logger(__name__)

_GUARD_MARK = "_saka_reset_guard"

CallConnectionLost = Callable[[Any, "BaseException | None"], None]


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
            logger.debug(
                "proactor_reset_on_close",
                errno=err.errno,
                winerror=getattr(err, "winerror", None),
                close_failed=close_failed,
            )

    setattr(guarded, _GUARD_MARK, True)
    return guarded


def install_proactor_reset_guard(platform: str = sys.platform) -> bool:
    """Install the guard on Windows' Proactor transport (idempotent).

    Returns True when this call installed it. No-op off Windows. Logs one
    ``proactor_reset_guard`` breadcrumb with the decision.
    """
    if platform != "win32":
        logger.debug("proactor_reset_guard", installed=False, reason="not_windows")
        return False

    from asyncio import proactor_events

    cls = proactor_events._ProactorBasePipeTransport
    # Private CPython API: reached via getattr/setattr (not in typeshed).
    current = getattr(cls, "_call_connection_lost")
    if getattr(current, _GUARD_MARK, False):
        logger.debug(
            "proactor_reset_guard", installed=False, reason="already_installed"
        )
        return False
    setattr(cls, "_call_connection_lost", tolerate_reset_on_close(current))
    logger.info("proactor_reset_guard", installed=True, reason="installed")
    return True
