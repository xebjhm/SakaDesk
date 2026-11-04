"""Hand-off between the backend and the desktop layer.

``desktop.py`` registers handlers once the window exists. Toast callbacks run
on a WinRT thread and call :func:`open_chat` or :func:`open_window`, which
never raise. The backend pushes the tray tooltip with :func:`set_tray_tooltip`,
and desktop threads (the tray) schedule coroutines on the uvicorn event loop
with :func:`run_on_server_loop`.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
from collections.abc import Callable, Coroutine
from typing import Any

import structlog

from backend.services.notification_planner import ChatTarget

logger = structlog.get_logger(__name__)

_open_chat_handler: Callable[[ChatTarget, int | None], None] | None = None
_open_window_handler: Callable[[], None] | None = None
_tray_tooltip_handler: Callable[[str], None] | None = None
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
