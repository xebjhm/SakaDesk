"""SD-BE-SVC-18 — desktop notifications must fire off the event loop.

plyer's Windows backend makes blocking Win32 calls (plus a first-use import
cost); calling ``notify(...)`` directly inside the async ``start_sync`` stalls
the event loop exactly while the UI is polling ``/progress``. These tests pin
the async offload wrappers that run the blocking send via ``asyncio.to_thread``.
"""

import asyncio
from unittest.mock import MagicMock, patch

from backend.services import notification_service as ns


def setup_function():
    ns.set_notifications_enabled(True)


def test_notify_sync_complete_async_offloads_to_thread():
    """notify_sync_complete_async runs the blocking send via asyncio.to_thread."""
    mock_notification = MagicMock()

    async def run():
        with patch.dict(
            "sys.modules", {"plyer": MagicMock(notification=mock_notification)}
        ):
            with patch(
                "backend.services.notification_service.asyncio.to_thread",
                wraps=asyncio.to_thread,
            ) as mock_to_thread:
                result = await ns.notify_sync_complete_async(3, 2)
                return result, mock_to_thread.called

    result, offloaded = asyncio.run(run())
    assert result is True
    assert offloaded
    mock_notification.notify.assert_called_once()


def test_notify_sync_complete_async_no_messages_skips():
    """Zero new messages: no notification, no thread hop."""

    async def run():
        with patch(
            "backend.services.notification_service.asyncio.to_thread"
        ) as mock_to_thread:
            result = await ns.notify_sync_complete_async(0, 0)
            return result, mock_to_thread.called

    result, offloaded = asyncio.run(run())
    assert result is False
    assert offloaded is False  # short-circuited before any offload


def test_notify_new_messages_async_offloads():
    """notify_new_messages_async also offloads the blocking send."""
    mock_notification = MagicMock()

    async def run():
        with patch.dict(
            "sys.modules", {"plyer": MagicMock(notification=mock_notification)}
        ):
            return await ns.notify_new_messages_async("Miku", 2)

    assert asyncio.run(run()) is True
    mock_notification.notify.assert_called_once()
