"""Services whose session is dead and need a login (spec B1 §3-4).

``report`` is called after a renewal or sync failed: ``expired`` (the server
says the session is gone, ``SessionExpiredError`` / no cookies) marks at once;
``refresh_failed`` (``RefreshFailedError``: every refresh method failed, which
also happens briefly offline) marks after ``REFRESH_FAILED_STRIKES`` in a row.
Marking sends one Windows toast per expiry (when notifications are on), turns
the tray badge on and refreshes the tray tooltip (which lists marked services).
``clear`` runs after a successful login. State is in memory for this app run.
Logs ids and reasons only.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

import structlog

from backend.services import desktop_bridge
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.notification_service import send_login_alert
from backend.services.service_utils import get_service_display_name
from backend.services.settings_store import load_config
from backend.services.tray_tooltip import schedule_refresh

logger = structlog.get_logger(__name__)

RENEW_RETRY_SECONDS = 60.0
REFRESH_FAILED_STRIKES = 2

_marked: set[str] = set()
_strikes: dict[str, int] = {}
_cooldown_until: dict[str, float] = {}


async def _load_settings() -> dict[str, Any]:
    return dict(await load_config())


def needs_login(service: str) -> bool:
    """True when ``service`` is marked as needing a login."""
    return service in _marked


def needs_login_services() -> list[str]:
    """The marked services, sorted."""
    return sorted(_marked)


def may_renew(service: str, now: float | None = None) -> bool:
    """False while ``service`` is marked or inside its retry cooldown."""
    if service in _marked:
        return False
    now = time.monotonic() if now is None else now
    return now >= _cooldown_until.get(service, 0.0)


def note_renew_failure(service: str, now: float | None = None) -> None:
    """Start the ``RENEW_RETRY_SECONDS`` cooldown for ``service``."""
    now = time.monotonic() if now is None else now
    _cooldown_until[service] = now + RENEW_RETRY_SECONDS
    logger.info("session_alert", action="cooldown_started", service=service)


def report_success(service: str) -> None:
    """A renewal or sync worked: reset strikes and cooldown (a mark stays until login)."""
    _strikes.pop(service, None)
    _cooldown_until.pop(service, None)


async def report(service: str, kind: Literal["expired", "refresh_failed"]) -> bool:
    """Record a failure; return whether ``service`` is (now) marked as needing a login."""
    if service in _marked:
        logger.info(
            "session_alert_skipped",
            service=service,
            reason="already_alerted",
            kind=kind,
        )
        return True
    if kind == "refresh_failed":
        _strikes[service] = _strikes.get(service, 0) + 1
        if _strikes[service] < REFRESH_FAILED_STRIKES:
            logger.info(
                "session_alert_skipped",
                service=service,
                reason="first_strike",
                kind=kind,
            )
            return False
    _marked.add(service)
    _strikes.pop(service, None)
    logger.info("session_alert", action="marked", service=service, kind=kind)
    desktop_bridge.set_tray_alert(True)
    schedule_refresh()
    await _toast(service)
    return True


async def _toast(service: str) -> None:
    try:
        settings = await _load_settings()
        if not settings.get("notifications_enabled", True):
            logger.info(
                "session_alert_skipped", service=service, reason="notifications_off"
            )
            return
        language = await asyncio.to_thread(resolve_ui_language, settings)
        strings = get_strings("notifications", language)
        title = strings["login_title"].format(service=get_service_display_name(service))
        sent = await send_login_alert(service, title, strings["login_body"])
        logger.info(
            "session_alert",
            action="toast_sent" if sent else "toast_failed",
            service=service,
        )
    except Exception as e:
        logger.warning(
            "session_alert_toast_failed", service=service, error_type=type(e).__name__
        )


async def clear(service: str) -> None:
    """A login succeeded: forget the mark, strikes and cooldown."""
    was_marked = service in _marked
    _marked.discard(service)
    report_success(service)
    if not was_marked:
        return
    logger.info("session_alert", action="cleared", service=service)
    desktop_bridge.set_tray_alert(bool(_marked))
    schedule_refresh()


def _reset_for_tests() -> None:
    _marked.clear()
    _strikes.clear()
    _cooldown_until.clear()
