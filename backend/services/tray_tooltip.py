"""Keep the tray tooltip in step with the unread total.

``refresh_tray_tooltip`` computes the text and hands it to
``desktop_bridge.set_tray_tooltip``. It runs after each sync
(:func:`schedule_refresh`) and after read-state writes
(:func:`schedule_refresh_debounced`, which coalesces bursts). Nothing is
scheduled when no tray registered a tooltip handler (no tray, or not Windows).
"""

from __future__ import annotations

import asyncio

import structlog

from backend.services import desktop_bridge
from backend.services.background_tasks import track_background_task
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.settings_store import load_config
from backend.services.unread_summary import tooltip_text, unread_total

logger = structlog.get_logger(__name__)

DEBOUNCE_SECONDS = 2.0

_debounce_task: asyncio.Task[None] | None = None
# Serializes compute+set so an older computation can never overwrite a newer
# one. Created lazily: an asyncio.Lock binds to the loop that first waits on it.
_refresh_lock: asyncio.Lock | None = None
_refresh_lock_loop: asyncio.AbstractEventLoop | None = None


def _get_refresh_lock() -> asyncio.Lock:
    global _refresh_lock, _refresh_lock_loop
    loop = asyncio.get_running_loop()
    if _refresh_lock is None or _refresh_lock_loop is not loop:
        _refresh_lock, _refresh_lock_loop = asyncio.Lock(), loop
    return _refresh_lock


async def refresh_tray_tooltip() -> None:
    """Compute the unread tooltip and push it to the tray. Never raises.

    Does nothing when no tooltip handler is registered. Concurrent calls run one
    at a time (compute and set together), so the last call to start is the last
    to set. Logs ``tray_tooltip``
    (``unread``) on success and ``tray_tooltip_failed`` (error type only) on
    failure.
    """
    if not desktop_bridge.has_tray_tooltip_handler():
        return
    try:
        async with _get_refresh_lock():
            unread = await unread_total()
            config = await load_config()
            language = await asyncio.to_thread(resolve_ui_language, config)
            text = tooltip_text(unread, get_strings("tray", language))
            desktop_bridge.set_tray_tooltip(text)
            logger.info("tray_tooltip", unread=unread)
    except Exception as e:
        logger.warning("tray_tooltip_failed", error_type=type(e).__name__)


def _running_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def schedule_refresh() -> asyncio.Task[None] | None:
    """Refresh in the background without blocking the caller.

    Returns the task, or ``None`` when there is no tray handler or no running
    event loop. Never raises.
    """
    if not desktop_bridge.has_tray_tooltip_handler() or _running_loop() is None:
        return None
    return track_background_task(refresh_tray_tooltip(), name="tray_tooltip")


async def _refresh_after_delay() -> None:
    await asyncio.sleep(DEBOUNCE_SECONDS)
    await refresh_tray_tooltip()


def schedule_refresh_debounced() -> asyncio.Task[None] | None:
    """Refresh once ``DEBOUNCE_SECONDS`` after the last call (bursts coalesce).

    Each call cancels the previous pending task and starts a new one. Returns
    the task, or ``None`` when there is no tray handler or no running event
    loop. Never raises.
    """
    global _debounce_task
    loop = _running_loop()
    if not desktop_bridge.has_tray_tooltip_handler() or loop is None:
        return None
    previous = _debounce_task
    if previous is not None and not previous.done():
        try:
            previous.cancel()
        except RuntimeError:  # its loop is gone (e.g. a previous test run)
            pass
    _debounce_task = track_background_task(
        _refresh_after_delay(), name="tray_tooltip_debounced"
    )
    return _debounce_task


async def cancel_pending() -> None:
    """Cancel a waiting debounced refresh and wait for it to unwind."""
    global _debounce_task
    task, _debounce_task = _debounce_task, None
    if task is None or task.done():
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, RuntimeError):
        pass
