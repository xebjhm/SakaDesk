"""Services whose session is dead and need a login (spec B1 §3-4).

``report`` is called after a renewal or sync failed: ``expired`` (the server
says the session is gone, ``SessionExpiredError`` / no cookies) marks at once;
``refresh_failed`` (``RefreshFailedError``: every refresh method failed, which
also happens while offline) marks after ``REFRESH_FAILED_STRIKES`` in a row.
Marking sends one Windows toast per expiry (when notifications are on), turns
the tray badge on and refreshes the tray tooltip (which lists marked services).

The kind of each mark is kept. An ``expired`` mark is sticky: no renewal is
tried until a login or logout calls ``clear``. A ``refresh_failed`` mark still
allows one renewal attempt every ``MARKED_RETRY_SECONDS``, so a session that was
only unreachable (offline) recovers by itself: the caller calls ``clear`` when
that retry (or a completed sync) proves the session alive, which removes the
badge and the tooltip line. State is in memory for this app run. Logs ids,
kinds and reasons only.
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

AlertKind = Literal["expired", "refresh_failed"]

RENEW_RETRY_SECONDS = 60.0
REFRESH_FAILED_STRIKES = 2
MARKED_RETRY_SECONDS = 600.0

_marked: dict[str, AlertKind] = {}
_strikes: dict[str, int] = {}
_cooldown_until: dict[str, float] = {}
# Earliest retry of a ``refresh_failed`` mark (monotonic seconds).
_marked_retry_at: dict[str, float] = {}


async def _load_settings() -> dict[str, Any]:
    return dict(await load_config())


def needs_login(service: str) -> bool:
    """True when ``service`` is marked as needing a login."""
    return service in _marked


def needs_login_services() -> list[str]:
    """The marked services, sorted."""
    return sorted(_marked)


def mark_kind(service: str) -> AlertKind | None:
    """The kind of ``service``'s mark, or ``None`` when it is not marked."""
    return _marked.get(service)


def renew_block_reason(service: str, now: float | None = None) -> str | None:
    """Why a renewal of ``service`` must not run now, or ``None`` when it may.

    ``marked_expired`` (sticky until login), ``marked_retry_wait`` (a
    ``refresh_failed`` mark inside ``MARKED_RETRY_SECONDS``) or ``cooldown``
    (inside ``RENEW_RETRY_SECONDS`` after a failure).
    """
    now = time.monotonic() if now is None else now
    kind = _marked.get(service)
    if kind == "expired":
        return "marked_expired"
    if kind == "refresh_failed" and now < _marked_retry_at.get(service, 0.0):
        return "marked_retry_wait"
    if now < _cooldown_until.get(service, 0.0):
        return "cooldown"
    return None


def may_renew(service: str, now: float | None = None) -> bool:
    """True when ``renew_block_reason`` finds nothing blocking a renewal."""
    return renew_block_reason(service, now) is None


def note_renew_failure(service: str, now: float | None = None) -> None:
    """Start the ``RENEW_RETRY_SECONDS`` cooldown (and, when marked, the slow retry wait)."""
    now = time.monotonic() if now is None else now
    _cooldown_until[service] = now + RENEW_RETRY_SECONDS
    if _marked.get(service) == "refresh_failed":
        _marked_retry_at[service] = now + MARKED_RETRY_SECONDS
        logger.info("session_alert", action="marked_retry_scheduled", service=service)
    logger.info("session_alert", action="cooldown_started", service=service)


def report_success(service: str) -> None:
    """A renewal or sync worked: reset strikes and cooldown (``clear`` removes a mark)."""
    _strikes.pop(service, None)
    _cooldown_until.pop(service, None)


async def report(service: str, kind: AlertKind, now: float | None = None) -> bool:
    """Record a failure; return whether ``service`` is (now) marked as needing a login.

    A second report on a marked service never toasts again. An ``expired``
    report upgrades a ``refresh_failed`` mark to the sticky kind.
    """
    current = _marked.get(service)
    if current is not None:
        if kind == "expired" and current == "refresh_failed":
            _marked[service] = "expired"
            _marked_retry_at.pop(service, None)
            logger.info(
                "session_alert", action="mark_upgraded", service=service, kind=kind
            )
        else:
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
        now = time.monotonic() if now is None else now
        _marked_retry_at[service] = now + MARKED_RETRY_SECONDS
    _marked[service] = kind
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
    """The session is alive again (login, logout, or a renewal / sync that worked).

    Forgets the mark, strikes, cooldown and retry wait; when a mark was removed
    the tray badge and tooltip are refreshed.
    """
    kind = _marked.pop(service, None)
    _marked_retry_at.pop(service, None)
    report_success(service)
    if kind is None:
        return
    logger.info("session_alert", action="cleared", service=service, kind=kind)
    desktop_bridge.set_tray_alert(bool(_marked))
    schedule_refresh()


def _reset_for_tests() -> None:
    _marked.clear()
    _strikes.clear()
    _cooldown_until.clear()
    _marked_retry_at.clear()
