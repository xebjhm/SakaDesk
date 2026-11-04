"""Hand-off from a toast click to the desktop window.

``desktop.py`` registers a handler once the window exists. Toast callbacks run
on a WinRT thread and call :func:`open_chat`, which never raises.
"""

from __future__ import annotations

from collections.abc import Callable

import structlog

from backend.services.notification_planner import ChatTarget

logger = structlog.get_logger(__name__)

_open_chat_handler: Callable[[ChatTarget, int | None], None] | None = None


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
