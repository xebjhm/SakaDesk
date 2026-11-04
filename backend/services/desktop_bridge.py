"""Hand-off between the backend and the desktop layer.

``desktop.py`` registers handlers once the window exists. Toast callbacks run
on a WinRT thread and call :func:`open_chat` or :func:`open_window`, which
never raise. The backend pushes the tray tooltip with :func:`set_tray_tooltip`,
and desktop threads (the tray) schedule coroutines on the uvicorn event loop
with :func:`run_on_server_loop`. The call popup host
(``set_call_popup_host``) runs blocking GUI calls; every async ``call_popup_*``
wrapper runs them in a worker thread with a timeout and never raises.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

import structlog

from backend.services.notification_planner import ChatTarget

logger = structlog.get_logger(__name__)

_open_chat_handler: Callable[[ChatTarget], None] | None = None
_open_window_handler: Callable[[], None] | None = None
_tray_tooltip_handler: Callable[[str], None] | None = None
_tray_tooltip_unhandled_logged = False
_server_loop: asyncio.AbstractEventLoop | None = None


def set_open_chat_handler(handler: Callable[[ChatTarget], None] | None) -> None:
    """Register (or clear, with ``None``) the function that opens a chat."""
    global _open_chat_handler
    _open_chat_handler = handler


def open_chat(target: ChatTarget) -> None:
    """Ask the window to open ``target``'s chat. Never raises.

    Logs ``notify_click_unhandled`` when no handler is registered and
    ``notify_open_chat_failed`` (error type only) when the handler raises.
    """
    handler = _open_chat_handler
    if handler is None:
        logger.info(
            "notify_click_unhandled",
            reason="no_handler",
            service=target.service,
        )
        return
    try:
        handler(target)
    except Exception as e:
        logger.warning(
            "notify_open_chat_failed",
            service=target.service,
            error_type=type(e).__name__,
        )


def set_open_window_handler(handler: Callable[[], None] | None) -> None:
    """Register (or clear, with ``None``) the function that shows the window."""
    global _open_window_handler
    _open_window_handler = handler


def open_window() -> None:
    """Ask the desktop to show (and focus) the main window. Never raises.

    Logs ``window_open_unhandled`` when no handler is registered and
    ``window_open_failed`` (error type only) when the handler raises.
    """
    handler = _open_window_handler
    if handler is None:
        logger.info("window_open_unhandled", reason="no_handler")
        return
    try:
        handler()
    except Exception as e:
        logger.warning("window_open_failed", error_type=type(e).__name__)


def set_tray_tooltip_handler(handler: Callable[[str], None] | None) -> None:
    """Register (or clear, with ``None``) the function that sets the tray tooltip."""
    global _tray_tooltip_handler, _tray_tooltip_unhandled_logged
    _tray_tooltip_handler = handler
    _tray_tooltip_unhandled_logged = False


def has_tray_tooltip_handler() -> bool:
    """True when a tray tooltip handler is registered."""
    return _tray_tooltip_handler is not None


def set_tray_tooltip(text: str) -> None:
    """Ask the desktop to show ``text`` as the tray tooltip. Never raises.

    Logs ``tray_tooltip_unhandled`` once (until a handler is registered or
    cleared again) when no handler is registered, and ``tray_tooltip_failed``
    (error type only) when the handler raises.
    """
    global _tray_tooltip_unhandled_logged
    handler = _tray_tooltip_handler
    if handler is None:
        if not _tray_tooltip_unhandled_logged:
            _tray_tooltip_unhandled_logged = True
            logger.info("tray_tooltip_unhandled", reason="no_handler")
        return
    try:
        handler(text)
    except Exception as e:
        logger.warning("tray_tooltip_failed", error_type=type(e).__name__)


def set_server_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Remember (or clear, with ``None``) the uvicorn event loop.

    Called from the FastAPI lifespan so desktop threads can schedule work on it.
    """
    global _server_loop
    _server_loop = loop


def run_on_server_loop(
    coro: Coroutine[Any, Any, Any],
) -> concurrent.futures.Future[Any] | None:
    """Schedule ``coro`` on the server loop from another thread.

    Returns the ``concurrent.futures.Future`` of the result, or ``None`` (after
    closing ``coro``, so it is never "awaited"-warned) when no loop is
    registered or the loop is closed. Logs ``server_loop_unavailable``
    (``reason``) in that case. Never raises.
    """
    loop = _server_loop
    if loop is None or loop.is_closed():
        coro.close()
        logger.info(
            "server_loop_unavailable",
            reason="no_loop" if loop is None else "closed",
        )
        return None
    try:
        return asyncio.run_coroutine_threadsafe(coro, loop)
    except Exception as e:
        coro.close()
        logger.warning("server_loop_unavailable", reason=type(e).__name__)
        return None


# ------------------------------------------------------------ call popup host

BRIDGE_TIMEOUT_S = 10.0
# start may recreate a lost popup window (POPUP_LOAD_TIMEOUT_S = 15 in the host).
BRIDGE_START_TIMEOUT_S = 20.0

_T = TypeVar("_T")


@dataclass(frozen=True)
class HeardTarget:
    """What the main window marks heard. ``path`` is never logged."""

    service: str
    path: str
    message_id: int


class CallPopupHost(Protocol):
    """The desktop popup window host.

    ``available()`` must be a non-blocking flag read (no window or Win32 calls):
    the gate calls it directly on the server loop. Every other method may block,
    so the bridge runs it on a worker thread with a timeout.
    """

    def available(self) -> bool: ...
    def ensure(self) -> bool: ...
    def start(self, call_id: int) -> bool: ...
    def reveal(self, call_id: int) -> bool: ...
    def hide(self, call_id: int) -> None: ...
    def cancel(self, call_id: int) -> None: ...
    def deliver_heard(self, target: HeardTarget) -> str: ...


_call_popup_host: CallPopupHost | None = None
_call_popup_unavailable_logged = False


def set_call_popup_host(host: CallPopupHost | None) -> None:
    """Register (or clear, with ``None``) the desktop popup window host.

    Also re-arms the once-only ``call_popup_unavailable`` log.
    """
    global _call_popup_host, _call_popup_unavailable_logged
    _call_popup_host = host
    _call_popup_unavailable_logged = False


def _host_or_log() -> CallPopupHost | None:
    global _call_popup_unavailable_logged
    host = _call_popup_host
    if host is None and not _call_popup_unavailable_logged:
        _call_popup_unavailable_logged = True
        logger.info("call_popup_unavailable", reason="no_host")
    return host


def call_popup_available() -> bool:
    """True when a host is registered and reports itself available. Never raises."""
    host = _host_or_log()
    if host is None:
        return False
    try:
        return bool(host.available())
    except Exception as e:
        logger.warning(
            "call_popup_bridge_failed", op="available", error_type=type(e).__name__
        )
        return False


async def _run_host(
    op: str,
    call: Callable[[CallPopupHost], _T],
    *,
    failed: _T,
    no_host: _T,
    timeout: float,
) -> _T:
    """Run ``call(host)`` in a worker thread with ``timeout``. Never raises.

    Returns ``no_host`` when no host is registered and ``failed`` on a timeout
    (``call_popup_bridge_failed`` ``reason=timeout``) or an exception
    (``error_type`` only).
    """
    host = _host_or_log()
    if host is None:
        return no_host
    try:
        return await asyncio.wait_for(asyncio.to_thread(call, host), timeout)
    except asyncio.TimeoutError:
        logger.warning("call_popup_bridge_failed", op=op, reason="timeout")
    except Exception as e:
        logger.warning("call_popup_bridge_failed", op=op, error_type=type(e).__name__)
    return failed


async def call_popup_start(call_id: int) -> bool:
    """True when the popup page's ``start`` ran. Never raises."""
    return bool(
        await _run_host(
            "start",
            lambda h: h.start(call_id),
            failed=False,
            no_host=False,
            timeout=BRIDGE_START_TIMEOUT_S,
        )
    )


async def call_popup_reveal(call_id: int) -> bool:
    """True when the popup window was shown for ``call_id``. Never raises."""
    return bool(
        await _run_host(
            "reveal",
            lambda h: h.reveal(call_id),
            failed=False,
            no_host=False,
            timeout=BRIDGE_TIMEOUT_S,
        )
    )


async def call_popup_hide(call_id: int) -> None:
    """Hide the popup window unless a newer call owns it. Never raises."""
    await _run_host(
        "hide",
        lambda h: h.hide(call_id),
        failed=None,
        no_host=None,
        timeout=BRIDGE_TIMEOUT_S,
    )


async def call_popup_cancel(call_id: int) -> None:
    """Cancel ``call_id`` in the popup page. Never raises."""
    await _run_host(
        "cancel",
        lambda h: h.cancel(call_id),
        failed=None,
        no_host=None,
        timeout=BRIDGE_TIMEOUT_S,
    )


async def call_popup_deliver_heard(target: HeardTarget) -> str:
    """``delivered`` | ``not_ready`` from the host, else ``error`` | ``no_host``."""
    return await _run_host(
        "deliver_heard",
        lambda h: h.deliver_heard(target),
        failed="error",
        no_host="no_host",
        timeout=BRIDGE_TIMEOUT_S,
    )


def call_popup_ensure() -> None:
    """Create the popup window if absent, on a daemon thread. Never blocks, never raises."""
    host = _host_or_log()
    if host is None:
        return

    def run() -> None:
        try:
            host.ensure()
        except Exception as e:
            logger.warning(
                "call_popup_bridge_failed", op="ensure", error_type=type(e).__name__
            )

    threading.Thread(target=run, name="call_popup_ensure", daemon=True).start()
