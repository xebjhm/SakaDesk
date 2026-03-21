"""
Notification Settings API for SakaDesk.

Provides endpoints to manage desktop notification preferences.
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.notification_service import (
    set_notifications_enabled,
    get_notification_status,
    send_notification,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationSettings(BaseModel):
    """Notification settings model."""

    enabled: bool


class NotificationStatus(BaseModel):
    """Notification system status."""

    enabled: bool
    plyer_available: bool
    last_error: Optional[str]


@router.get("", response_model=NotificationStatus)
async def get_status():
    """Get notification system status."""
    status = get_notification_status()
    return NotificationStatus(**status)


@router.put("")
async def update_settings(settings: NotificationSettings):
    """Update notification settings."""
    set_notifications_enabled(settings.enabled)
    return {"enabled": settings.enabled}


@router.post("/test")
async def test_notification():
    """Send a test notification to verify the system works."""
    success = send_notification(
        title="SakaDesk Test",
        message="Notifications are working!",
        timeout=5,
    )
    return {
        "success": success,
        "message": "Test notification sent"
        if success
        else "Failed to send notification",
    }
