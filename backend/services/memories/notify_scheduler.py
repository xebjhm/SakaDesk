"""Memories notification scheduler (spec 15).

This module is a placeholder: M4 Task 5 completes it with the asyncio task
that computes due occasions, claims them in the app_state ledger and
delivers the toasts. For now it only exposes
:func:`memories_notify_settings_changed`, which the settings API calls when a
``memories_notify_*`` setting changes.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)


def memories_notify_settings_changed() -> None:
    """Ask the scheduler to re-plan after a Memories notify setting changed.

    No scheduler runs yet, so nothing is woken; the breadcrumb says so.
    """
    logger.info("memories_notify_wake_requested", woken=False)
