"""Native desktop toasts for SakaDesk.

The planner (:mod:`backend.services.notification_planner`) decides what to
show; this module delivers it. On Windows a toast is sent through
``windows_toasts`` under the ``SakaDesk`` AUMID, and clicking it opens the chat
via :mod:`backend.services.desktop_bridge`. Everywhere else (or when
``windows_toasts`` cannot be imported) a :class:`NullNotifier` is used.

Logs carry ids, counts, codes and error types only: never titles, bodies,
names, paths or URLs.
"""

from __future__ import annotations

import asyncio
import re
import sys
import threading
import warnings
from collections import deque
from typing import Any, Protocol
from urllib.parse import parse_qs, urlencode

import structlog

from backend.services import desktop_bridge
from backend.services.i18n import get_strings
from backend.services.notification_planner import ChatTarget, ToastPlan

logger = structlog.get_logger(__name__)

AUMID = "SakaDesk"
_BACKEND_WINDOWS = "windows_toasts"
_BACKEND_NONE = "none"
_LIVE_TOASTS = 64  # keep recent Toast objects alive so WinRT callbacks still fire

_notifications_enabled = True

# windows_toasts warns when a launch string has no URL scheme; ours is a plain
# query string handled by parse_launch_args. The warning text embeds the launch
# string (names, paths), so it must never reach the logs.
_LAUNCH_WARNING = r"Ensure your launch action"


def _silence_launch_action_warning() -> None:
    """Install the targeted filter. Idempotent: ``filterwarnings`` de-duplicates."""
    warnings.filterwarnings("ignore", message=_LAUNCH_WARNING, category=UserWarning)


class Notifier(Protocol):
    """Shows one planned toast and reports its own health."""

    def show(self, plan: ToastPlan) -> bool: ...

    def status(self) -> dict: ...


# ------------------------------------------------------------ launch arguments


def build_launch_args(target: ChatTarget) -> str:
    """Encode ``target`` as the toast's launch string (a URL-encoded query)."""
    return urlencode(
        {
            "action": "open",
            "service": target.service,
            "path": target.path,
            "name": target.name,
            "group": "1" if target.is_group_chat else "0",
        }
    )


def parse_launch_args(args: object) -> ChatTarget | None:
    """Decode a launch string from :func:`build_launch_args`; ``None`` if invalid."""
    if not isinstance(args, str) or not args:
        return None
    try:
        q = parse_qs(args, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return None
    if q.get("action") != ["open"]:
        return None
    service = (q.get("service") or [""])[0]
    path = (q.get("path") or [""])[0]
    name = (q.get("name") or [""])[0]
    group = (q.get("group") or [""])[0]
    if not service or not path or group not in ("0", "1"):
        return None
    return ChatTarget(service=service, path=path, name=name, is_group_chat=group == "1")


_LEADING_ID = re.compile(r"^(\d+)(?:\s|$)")


def _ids_from_path(target: ChatTarget) -> tuple[str, str]:
    """``(group_id, member_id)`` from the path's numeric folder prefixes.

    The path is ``<service>/messages/<group dir>[/<member dir>]``; a room has
    no member dir, so its member id is ``"0"``. ``""`` when a prefix is missing.
    """
    parts = target.path.split("/")
    if "messages" not in parts:
        return "", ""
    # Last "messages" component, as the planner does (a parent folder may share
    # the name).
    tail = parts[len(parts) - parts[::-1].index("messages") :]

    def lead(part: str) -> str:
        m = _LEADING_ID.match(part)
        return m.group(1) if m else ""

    group_id = lead(tail[0]) if tail else ""
    member_id = lead(tail[1]) if len(tail) > 1 else "0"
    return group_id, member_id


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

        _silence_launch_action_warning()
        self._wt = wt
        self._toaster = wt.InteractableWindowsToaster(AUMID, notifierAUMID=AUMID)
        self._last_error: str | None = None
        self._live: deque[Any] = deque(maxlen=_LIVE_TOASTS)

    def show(self, plan: ToastPlan) -> bool:
        """Show the toast; raises on failure (callers log ``notify_failed``)."""
        wt = self._wt
        try:
            toast = wt.Toast(
                text_fields=[plan.title, plan.body],
                launch_action=build_launch_args(plan.target),
            )
            if plan.avatar is not None:
                self._add_avatar(toast, plan)
            toast.on_activated = self._on_activated
            toast.on_failed = lambda args: self._on_failed(plan, args)
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

    def _on_activated(self, event_args: Any) -> None:
        """WinRT-thread callback. Never raises."""
        try:
            target = parse_launch_args(getattr(event_args, "arguments", None))
            if target is None:
                logger.info("notify_click_unhandled", reason="bad_arguments")
                return
            group_id, member_id = _ids_from_path(target)
            logger.info(
                "notify_clicked",
                service=target.service,
                group_id=group_id,
                member_id=member_id,
            )
            desktop_bridge.open_chat(target)
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
    )
    return await _show_one(await asyncio.to_thread(get_notifier), plan)


# TODO(C1 Task 8): remove. sync_service still awaits this until it is rewired
# to plan_toasts + send_planned; it now only logs.
async def notify_sync_complete_async(total_new: int, member_count: int) -> bool:
    """Legacy summary toast: gone. Logs the skip and returns ``False``."""
    if total_new <= 0:
        return False
    logger.info(
        "notify_skip",
        reason="legacy_summary_removed",
        count=total_new,
        members=member_count,
    )
    return False


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
