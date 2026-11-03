"""
Notification Settings API for SakaDesk.

Provides endpoints to manage desktop notification preferences.
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.i18n import get_strings
from backend.services.notification_service import (
    get_notification_status,
    send_test,
    set_notifications_enabled,
)
from backend.services.settings_store import load_config

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationSettings(BaseModel):
    """Notification settings model."""

    enabled: bool


class NotificationStatus(BaseModel):
    """Notification system status."""

    enabled: bool
    available: bool
    backend: str
    last_error: Optional[str]
    aumid: str


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
    """Send a test toast in the UI language; echo the strings it carries."""
    config = await load_config()
    language = config.get("language")
    strings = get_strings("notifications", language)
    success = await send_test(language)
    return {
        "success": success,
        "title": strings["test_title"],
        "body": strings["test_body"],
    }
