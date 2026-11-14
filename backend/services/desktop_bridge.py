"""Hand-off between the backend and the desktop layer.

``desktop.py`` registers handlers once the window exists. Toast callbacks run
on a WinRT thread and call :func:`open_chat` or :func:`open_window`, which
never raise (so do :func:`open_login`, which shows a service's login dialog,
:func:`open_memories`, which opens Memories at a route,
and :func:`set_tray_alert`, the tray warning badge). The backend pushes the tray tooltip with :func:`set_tray_tooltip`,
and desktop threads (the tray) schedule coroutines on the uvicorn event loop
with :func:`run_on_server_loop`. The call popup host
(``set_call_popup_host``) runs blocking GUI calls; every async ``call_popup_*``
wrapper runs them on a dedicated two-thread executor with a timeout and never
raises.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

import structlog

import host_js

from backend.services.notification_planner import ChatTarget

logger = structlog.get_logger(__name__)

_open_chat_handler: Callable[[ChatTarget, int | None], None] | None = None
_open_window_handler: Callable[[], None] | None = None
_tray_tooltip_handler: Callable[[str], None] | None = None
_open_login_handler: Callable[[str], None] | None = None
_open_memories_handler: Callable[[str, dict], None] | None = None
_open_memories_unhandled_logged = False
_tray_alert_handler: Callable[[bool], None] | None = None
_open_login_unhandled_logged = False
_tray_alert_unhandled_logged = False
_tray_tooltip_unhandled_logged = False
_server_loop: asyncio.AbstractEventLoop | None = None


def set_open_chat_handler(
    handler: Callable[[ChatTarget, int | None], None] | None,
) -> None:
    """Register (or clear, with ``None``) the function that opens a chat.

    The handler receives the target and the message id to scroll to (or
    ``None`` to open the chat without a jump).
    """
    global _open_chat_handler
    _open_chat_handler = handler


def open_chat(target: ChatTarget, message_id: int | None = None) -> None:
    """Ask the window to open ``target``'s chat at ``message_id``. Never raises.

    ``message_id`` is the message to scroll to; ``None`` opens the chat
    without a jump.

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
        handler(target, message_id)
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
# Host calls run on their own small pool, never the loop's default executor: a
# timed-out call leaves its thread blocked on the GUI, and the backend's many
# ``to_thread`` users must not be starved by a wedged popup.
HOST_EXECUTOR_WORKERS = 2
# This many timeouts in a row mark the popup unavailable for the process.
MAX_HOST_TIMEOUTS = 2

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
_host_executor: concurrent.futures.ThreadPoolExecutor | None = None
_host_executor_lock = threading.Lock()
_host_timeouts = 0  # consecutive timed-out host calls
_host_timed_out = False  # MAX_HOST_TIMEOUTS reached: unavailable for the process


def set_call_popup_host(host: CallPopupHost | None) -> None:
    """Register (or clear, with ``None``) the desktop popup window host.

    Also re-arms the once-only ``call_popup_unavailable`` log and the timeout
    breaker (the desktop registers its host once per process).
    """
    global _call_popup_host, _call_popup_unavailable_logged
    global _host_timeouts, _host_timed_out
    _call_popup_host = host
    _call_popup_unavailable_logged = False
    _host_timeouts, _host_timed_out = 0, False


def _executor() -> concurrent.futures.ThreadPoolExecutor:
    """The popup host's own executor, created on first use."""
    global _host_executor
    with _host_executor_lock:
        if _host_executor is None:
            _host_executor = concurrent.futures.ThreadPoolExecutor(
                max_workers=HOST_EXECUTOR_WORKERS, thread_name_prefix="call_popup_host"
            )
        return _host_executor


def shutdown_call_popup_executor() -> None:
    """App exit: stop the host executor without waiting for blocked calls.

    Queued calls are cancelled. A later host call creates a fresh executor.
    Never raises.
    """
    global _host_executor
    with _host_executor_lock:
        executor, _host_executor = _host_executor, None
    if executor is not None:
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except Exception as e:
            logger.warning(
                "call_popup_bridge_failed", op="shutdown", error_type=type(e).__name__
            )


def _note_timeout() -> None:
    global _host_timeouts, _host_timed_out
    _host_timeouts += 1
    if _host_timeouts >= MAX_HOST_TIMEOUTS and not _host_timed_out:
        _host_timed_out = True
        logger.warning(
            "call_popup_unavailable", reason="host_timeouts", timeouts=_host_timeouts
        )


def _host_or_log() -> CallPopupHost | None:
    global _call_popup_unavailable_logged
    host = _call_popup_host
    if host is None and not _call_popup_unavailable_logged:
        _call_popup_unavailable_logged = True
        logger.info("call_popup_unavailable", reason="no_host")
    return host


def call_popup_available() -> bool:
    """True when a host is registered and reports itself available. Never raises.

    False for the rest of the process once ``MAX_HOST_TIMEOUTS`` host calls in
    a row timed out (``call_popup_unavailable reason=host_timeouts``). A flag
    read: it never blocks.
    """
    if _host_timed_out:
        return False
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
    """Run ``call(host)`` on the host executor with ``timeout``. Never raises.

    Returns ``no_host`` when no host is registered and ``failed`` on a timeout
    (``call_popup_bridge_failed`` ``reason=timeout``) or an exception
    (``error_type``, plus ``js_error`` when the page script threw: its error name, or ``other``). Timeouts in a row are counted (any call that
    completes resets the count); see :func:`call_popup_available`.
    """
    global _host_timeouts
    host = _host_or_log()
    if host is None:
        return no_host
    try:
        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(_executor(), call, host), timeout
        )
    except asyncio.TimeoutError:
        logger.warning("call_popup_bridge_failed", op=op, reason="timeout")
        _note_timeout()
        return failed
    except Exception as e:
        _host_timeouts = 0
        logger.warning(
            "call_popup_bridge_failed",
            op=op,
            error_type=type(e).__name__,
            **host_js.error_fields(e),
        )
        return failed
    _host_timeouts = 0
    return result


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


def set_open_login_handler(handler: Callable[[str], None] | None) -> None:
    """Register (or clear) the host function that opens the login dialog for a service."""
    global _open_login_handler, _open_login_unhandled_logged
    _open_login_handler = handler
    _open_login_unhandled_logged = False


def open_login(service: str) -> None:
    """Show the main window on ``service``'s login dialog. Never raises.

    Logs ``login_open_unhandled`` once (until a handler is registered or cleared
    again) when no handler is registered, and ``login_open_failed`` (error type
    only) when the handler raises.
    """
    global _open_login_unhandled_logged
    handler = _open_login_handler
    if handler is None:
        if not _open_login_unhandled_logged:
            _open_login_unhandled_logged = True
            logger.info("login_open_unhandled", reason="no_handler")
        return
    try:
        handler(service)
    except Exception as e:
        logger.warning("login_open_failed", error_type=type(e).__name__)


def set_open_memories_handler(handler: Callable[[str, dict], None] | None) -> None:
    """Register (or clear) the host function that opens Memories at a route."""
    global _open_memories_handler, _open_memories_unhandled_logged
    _open_memories_handler = handler
    _open_memories_unhandled_logged = False


def open_memories(service: str, route: dict) -> None:
    """Show the main window on Memories for ``service`` at ``route``. Never raises.

    Logs ``memories_open_unhandled`` once (until a handler is registered or
    cleared again) when no handler is registered, and ``memories_open_failed``
    (error type only) when the handler raises. The route is never logged.
    """
    global _open_memories_unhandled_logged
    handler = _open_memories_handler
    if handler is None:
        if not _open_memories_unhandled_logged:
            _open_memories_unhandled_logged = True
            logger.info("memories_open_unhandled", reason="no_handler")
        return
    try:
        handler(service, route)
    except Exception as e:
        logger.warning("memories_open_failed", error_type=type(e).__name__)


def set_tray_alert_handler(handler: Callable[[bool], None] | None) -> None:
    """Register (or clear) the tray's warning-badge switch."""
    global _tray_alert_handler, _tray_alert_unhandled_logged
    _tray_alert_handler = handler
    _tray_alert_unhandled_logged = False


def set_tray_alert(on: bool) -> None:
    """Turn the tray warning badge on or off. Never raises; no-op without a tray.

    Logs ``tray_alert_unhandled`` once (until a handler is registered or cleared
    again) when no handler is registered, and ``tray_alert_failed`` (error type
    only) when the handler raises.
    """
    global _tray_alert_unhandled_logged
    handler = _tray_alert_handler
    if handler is None:
        if not _tray_alert_unhandled_logged:
            _tray_alert_unhandled_logged = True
            logger.info("tray_alert_unhandled", reason="no_handler")
        return
    try:
        handler(on)
    except Exception as e:
        logger.warning("tray_alert_failed", error_type=type(e).__name__)
