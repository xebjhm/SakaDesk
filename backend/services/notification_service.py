"""
Desktop Notification Service for HakoDesk.

Provides cross-platform desktop notifications using plyer.
Notifications are triggered when new messages arrive during sync.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Track notification state
_notifications_enabled = True
_last_notification_error: Optional[str] = None


def is_plyer_available() -> bool:
    """Check if plyer notification is available on this system."""
    try:
        from plyer import notification
        return True
    except ImportError:
        return False


def send_notification(
    title: str,
    message: str,
    app_name: str = "HakoDesk",
    timeout: int = 10,
) -> bool:
    """
    Send a desktop notification.

    Args:
        title: Notification title
        message: Notification body text
        app_name: Application name shown in notification
        timeout: How long notification stays visible (seconds)

    Returns:
        True if notification was sent successfully, False otherwise
    """
    global _last_notification_error

    if not _notifications_enabled:
        return False

    try:
        from plyer import notification

        notification.notify(
            title=title,
            message=message,
            app_name=app_name,
            timeout=timeout,
        )
        _last_notification_error = None
        return True

    except ImportError:
        _last_notification_error = "plyer not installed"
        logger.warning("plyer not installed - notifications disabled")
        return False

    except Exception as e:
        _last_notification_error = str(e)
        logger.warning(f"Failed to send notification: {e}")
        return False


def notify_new_messages(member_name: str, count: int) -> bool:
    """
    Send notification for new messages from a member.

    Args:
        member_name: Name of the member who sent messages
        count: Number of new messages

    Returns:
        True if notification was sent
    """
    if count <= 0:
        return False

    if count == 1:
        message = f"New message from {member_name}"
    else:
        message = f"{count} new messages from {member_name}"

    return send_notification(
        title="HakoDesk",
        message=message,
        timeout=5,
    )


def notify_sync_complete(total_new: int, member_count: int) -> bool:
    """
    Send notification when sync completes with new messages.

    Args:
        total_new: Total number of new messages
        member_count: Number of members with new messages

    Returns:
        True if notification was sent
    """
    if total_new <= 0:
        return False

    if member_count == 1:
        message = f"{total_new} new message{'s' if total_new > 1 else ''}"
    else:
        message = f"{total_new} new messages from {member_count} members"

    return send_notification(
        title="Sync Complete",
        message=message,
        timeout=5,
    )


def set_notifications_enabled(enabled: bool) -> None:
    """Enable or disable notifications."""
    global _notifications_enabled
    _notifications_enabled = enabled
    logger.info(f"Notifications {'enabled' if enabled else 'disabled'}")


def get_notifications_enabled() -> bool:
    """Check if notifications are enabled."""
    return _notifications_enabled


def get_notification_status() -> dict:
    """Get notification system status for diagnostics."""
    return {
        "enabled": _notifications_enabled,
        "plyer_available": is_plyer_available(),
        "last_error": _last_notification_error,
    }
