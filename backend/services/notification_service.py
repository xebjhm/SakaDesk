"""Native desktop toasts for SakaDesk.

The planner (:mod:`backend.services.notification_planner`) decides what to
show; this module delivers it. On Windows a toast is sent through
``windows_toasts`` under the ``SakaDesk`` AUMID. A click fires the toast's
in-process ``on_activated`` callback, whose closure holds the plan, and opens
that chat via :mod:`backend.services.desktop_bridge`. No launch action is set:
in windows-toasts it turns the click into a protocol activation. Everywhere
else (or when ``windows_toasts`` cannot be imported) a :class:`NullNotifier`
is used.

Logs carry ids, counts, codes and error types only: never titles, bodies,
names, paths or URLs.
"""

from __future__ import annotations

import asyncio
import sys
import threading
from collections import deque
from typing import Any, Protocol

import structlog

from backend.services import desktop_bridge
from backend.services.app_identity import AUMID
from backend.services.i18n import get_strings
from backend.services.notification_planner import ChatTarget, ToastPlan

logger = structlog.get_logger(__name__)

_BACKEND_WINDOWS = "windows_toasts"
_BACKEND_NONE = "none"
_LIVE_TOASTS = 64  # keep recent Toast objects alive so WinRT callbacks still fire

_notifications_enabled = True


class Notifier(Protocol):
    """Shows one planned toast and reports its own health."""

    def show(self, plan: ToastPlan) -> bool: ...

    def status(self) -> dict: ...


# ------------------------------------------------------------------- notifiers


class NullNotifier:
    """Used where toasts are unavailable. ``show`` is a logged no-op."""

    def __init__(self, reason: str) -> None:
        self._reason = reason
        self._logged = False

    def show(self, plan: ToastPlan) -> bool:
        if not self._logged:
            self._logged = True
            logger.warning("notify_unavailable", reason=self._reason)
        return False

    def status(self) -> dict:
        return {
            "available": False,
            "backend": _BACKEND_NONE,
            "last_error": self._reason,
            "aumid": AUMID,
        }


class WindowsToastNotifier:
    """Sends toasts through ``windows_toasts`` (imported lazily).

    Raises ``ImportError`` (or another exception from the toaster) from
    ``__init__``; :func:`get_notifier` turns that into a :class:`NullNotifier`.
    """

    def __init__(self) -> None:
        import windows_toasts as wt  # lazy: Windows-only dependency

        self._wt = wt
        self._toaster = wt.InteractableWindowsToaster(AUMID, notifierAUMID=AUMID)
        self._last_error: str | None = None
        self._live: deque[Any] = deque(maxlen=_LIVE_TOASTS)

    def show(self, plan: ToastPlan) -> bool:
        """Show the toast; raises on failure (callers log ``notify_failed``)."""
        wt = self._wt
        try:
            # Never set launch_action: windows-toasts then makes the click a
            # protocol activation (Windows opens it as a URI) instead of
            # firing on_activated in this process.
            toast = wt.Toast(text_fields=[plan.title, plan.body])
            if plan.group_id and plan.member_id:
                # Ids only (<= 64 chars): a newer toast for the same chat
                # replaces the older one in the Action Center.
                toast.tag = f"{plan.group_id}:{plan.member_id}"
                toast.group = plan.target.service
            if plan.avatar is not None:
                self._add_avatar(toast, plan)
            toast.on_activated = lambda _args, p=plan: self._on_click(p)
            toast.on_failed = lambda args, p=plan: self._on_failed(p, args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def status(self) -> dict:
        return {
            "available": True,
            "backend": _BACKEND_WINDOWS,
            "last_error": self._last_error,
            "aumid": AUMID,
        }

    def _add_avatar(self, toast: Any, plan: ToastPlan) -> None:
        wt = self._wt
        try:
            toast.AddImage(
                wt.ToastDisplayImage(
                    wt.ToastImage(plan.avatar),
                    position=wt.ToastImagePosition.AppLogo,
                )
            )
        except Exception as e:
            # A missing or unreadable avatar must not cost the user the toast.
            logger.warning(
                "notify_failed",
                stage="avatar",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type=type(e).__name__,
            )

    def _on_click(self, plan: ToastPlan) -> None:
        """WinRT-thread ``on_activated`` callback for ``plan``'s toast. Never raises."""
        try:
            if not plan.target.service or not plan.target.path:
                # The test toast has no chat behind it.
                logger.info("notify_click_unhandled", reason="no_target")
                return
            logger.info(
                "notify_clicked",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
            )
            desktop_bridge.open_chat(plan.target)
        except Exception as e:
            logger.warning("notify_open_chat_failed", error_type=type(e).__name__)

    def _on_failed(self, plan: ToastPlan, event_args: Any) -> None:
        """WinRT-thread callback. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass


# ------------------------------------------------------------------- singleton

_notifier: Notifier | None = None
_notifier_lock = threading.Lock()


def _is_windows() -> bool:
    return sys.platform == "win32"


def _build_notifier() -> Notifier:
    if not _is_windows():
        return NullNotifier("not_windows")
    try:
        return WindowsToastNotifier()
    except ImportError:
        return NullNotifier("import_error")
    except Exception as e:
        logger.warning(
            "notify_unavailable", reason="init_error", error_type=type(e).__name__
        )
        return NullNotifier("init_error")


def get_notifier() -> Notifier:
    """The process-wide notifier (Windows toasts, else a :class:`NullNotifier`)."""
    global _notifier
    with _notifier_lock:
        if _notifier is None:
            _notifier = _build_notifier()
        return _notifier


def _reset_notifier_for_tests() -> None:
    global _notifier
    with _notifier_lock:
        _notifier = None


# -------------------------------------------------------------------- delivery


def _fail_fields(plan: ToastPlan) -> dict[str, Any]:
    return {
        "service": plan.target.service,
        "group_id": plan.group_id,
        "member_id": plan.member_id,
    }


async def _show_one(notifier: Notifier, plan: ToastPlan) -> bool:
    """Show ``plan`` on a worker thread; log the outcome. Never raises."""
    try:
        shown = await asyncio.to_thread(notifier.show, plan)
    except Exception as e:
        logger.warning(
            "notify_failed", **_fail_fields(plan), error_type=type(e).__name__
        )
        return False
    if not shown:
        logger.warning("notify_failed", **_fail_fields(plan), reason="not_shown")
        return False
    logger.info(
        "notify_sent",
        **_fail_fields(plan),
        count=plan.count,
        newest_type=plan.newest_type,
    )
    return True


async def send_planned(plans: list[ToastPlan]) -> int:
    """Show every plan (off the event loop) and return how many were shown.

    Skips everything when notifications are disabled (the planner already
    skips in that case, so this is a second guard) or when the notifier is
    unavailable (it logged why once; one summary line replaces a failure log
    per plan). The notifier is resolved on a worker thread: its first use
    imports ``windows_toasts``/WinRT and builds the toaster.
    """
    if not plans:
        return 0
    if not _notifications_enabled:
        logger.info("notify_skip", reason="disabled", count=len(plans))
        return 0
    notifier = await asyncio.to_thread(get_notifier)
    if not notifier.status().get("available", True):
        logger.info("notify_skip", reason="unavailable", count=len(plans))
        return 0
    sent = 0
    for plan in plans:
        if await _show_one(notifier, plan):
            sent += 1
    return sent


async def send_test(lang: str | None) -> bool:
    """Show a test toast in ``lang``. Ignores the enabled flag (user-initiated)."""
    strings = get_strings("notifications", lang)
    plan = ToastPlan(
        target=ChatTarget(service="", path="", name="", is_group_chat=False),
        group_id="",
        member_id="",
        title=strings["test_title"],
        body=strings["test_body"],
        avatar=None,
        count=1,
        newest_type="text",
        newest_id="",
    )
    return await _show_one(await asyncio.to_thread(get_notifier), plan)


# ---------------------------------------------------------------------- state


def set_notifications_enabled(enabled: bool) -> None:
    """Enable or disable notifications."""
    global _notifications_enabled
    _notifications_enabled = enabled
    logger.info("notifications_enabled_changed", enabled=enabled)


def get_notifications_enabled() -> bool:
    """Check if notifications are enabled."""
    return _notifications_enabled


def get_notification_status() -> dict:
    """Diagnostics: the enabled flag plus the notifier's own status."""
    return {"enabled": _notifications_enabled, **get_notifier().status()}
