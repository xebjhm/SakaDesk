"""Hand-off from a toast click to the desktop window.

``desktop.py`` registers a handler once the window exists. Toast callbacks run
on a WinRT thread and call :func:`open_chat`, which never raises.
"""

from __future__ import annotations

from collections.abc import Callable

import structlog

from backend.services.notification_planner import ChatTarget

logger = structlog.get_logger(__name__)

_open_chat_handler: Callable[[ChatTarget], None] | None = None


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
